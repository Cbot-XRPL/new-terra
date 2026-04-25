// DocuSign integration. We use the official `docusign-esign` SDK with JWT
// (impersonation) authentication so we can drive envelopes from the server
// without each rep needing their own DocuSign session.
//
// Real mode requires:
//   DOCUSIGN_INTEGRATION_KEY (RSA app's client_id, aka integration key)
//   DOCUSIGN_USER_ID         (impersonated user's API user ID)
//   DOCUSIGN_ACCOUNT_ID      (DocuSign account GUID)
//   DOCUSIGN_BASE_PATH       e.g. https://demo.docusign.net/restapi
//                                 or https://www.docusign.net/restapi
//   DOCUSIGN_OAUTH_BASE      e.g. account-d.docusign.com (demo)
//                                 or account.docusign.com (prod)
//   DOCUSIGN_RSA_PRIVATE_KEY (full PEM, line breaks preserved)
//   DOCUSIGN_HMAC_KEY        (Connect webhook HMAC secret, optional)
//
// When any required var is missing we run in stub mode: createEnvelope logs
// what would be sent and returns a synthetic envelope id. This keeps the
// rest of the app workable in development and lets us defer the credential
// rotation discussion.

import crypto from 'node:crypto';
import docusign from 'docusign-esign';

const REQUIRED = [
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_BASE_PATH',
  'DOCUSIGN_OAUTH_BASE',
  'DOCUSIGN_RSA_PRIVATE_KEY',
] as const;

export function isDocuSignConfigured(): boolean {
  return REQUIRED.every((k) => process.env[k] && String(process.env[k]).length > 0);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(process.env.DOCUSIGN_OAUTH_BASE!);
  const result = await apiClient.requestJWTUserToken(
    process.env.DOCUSIGN_INTEGRATION_KEY!,
    process.env.DOCUSIGN_USER_ID!,
    ['signature', 'impersonation'],
    Buffer.from(process.env.DOCUSIGN_RSA_PRIVATE_KEY!, 'utf8'),
    3600,
  );
  const token = (result.body as { access_token: string; expires_in: number }).access_token;
  const expiresIn =
    (result.body as { expires_in?: number }).expires_in ?? 3600;
  cachedToken = { value: token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

export interface CreateEnvelopeInput {
  pdf: Buffer;
  customerEmail: string;
  customerName: string;
  contractName: string;
  /** Caller-supplied id we tag onto the envelope so webhook events can
   *  resolve back to the right Contract row. */
  contractId: string;
  /** Where the customer should land after signing. */
  returnUrl?: string;
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  status: string;
  /** True when no DocuSign creds are configured and we faked the envelope. */
  stub: boolean;
}

export async function createEnvelopeForContract(
  input: CreateEnvelopeInput,
): Promise<CreateEnvelopeResult> {
  if (!isDocuSignConfigured()) {
    const envelopeId = `stub-${crypto.randomBytes(8).toString('hex')}`;
    console.log(
      '[docusign:stub] Would create envelope for',
      input.customerEmail,
      'contract',
      input.contractId,
      '→',
      envelopeId,
    );
    return { envelopeId, status: 'sent', stub: true };
  }

  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(process.env.DOCUSIGN_BASE_PATH!);
  apiClient.addDefaultHeader('Authorization', `Bearer ${await getAccessToken()}`);

  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const document = new docusign.Document();
  document.documentBase64 = input.pdf.toString('base64');
  document.name = `${input.contractName}.pdf`;
  document.fileExtension = 'pdf';
  document.documentId = '1';

  const signer = docusign.Signer.constructFromObject({
    email: input.customerEmail,
    name: input.customerName,
    recipientId: '1',
    routingOrder: '1',
  });

  // Anchor-based tab placement: DocuSign will scan the PDF text for the
  // string "Signed:" (rendered by our PDF generator) and drop a signature
  // tab immediately after it. Adjust offsets if the layout changes.
  const signHere = docusign.SignHere.constructFromObject({
    anchorString: 'Signed:',
    anchorUnits: 'pixels',
    anchorXOffset: '40',
    anchorYOffset: '-2',
  });
  signer.tabs = docusign.Tabs.constructFromObject({ signHereTabs: [signHere] });

  const definition = new docusign.EnvelopeDefinition();
  definition.emailSubject = `Please sign: ${input.contractName}`;
  definition.documents = [document];
  definition.recipients = docusign.Recipients.constructFromObject({ signers: [signer] });
  definition.status = 'sent';
  // customFields lets the webhook handler resolve the envelope back to our
  // Contract row without depending on signer email lookups.
  definition.customFields = docusign.CustomFields.constructFromObject({
    textCustomFields: [
      docusign.TextCustomField.constructFromObject({
        name: 'newterra_contract_id',
        value: input.contractId,
        show: 'false',
        required: 'false',
      }),
    ],
  });

  const result = await envelopesApi.createEnvelope(process.env.DOCUSIGN_ACCOUNT_ID!, {
    envelopeDefinition: definition,
  });

  return { envelopeId: result.envelopeId!, status: result.status ?? 'sent', stub: false };
}

/**
 * Verify a DocuSign Connect HMAC signature header. Returns true when no
 * HMAC key is configured (development) so local testing isn't blocked.
 */
export function verifyConnectSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
  const key = process.env.DOCUSIGN_HMAC_KEY;
  if (!key) return true;
  if (!signatureHeader) return false;
  const computed = crypto
    .createHmac('sha256', key)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
    .digest('base64');
  // Use timing-safe compare; both sides must be the same length first.
  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Map DocuSign envelope status to our internal contract status.
 * "completed" means everyone signed; "declined" / "voided" are terminal too.
 */
export function mapEnvelopeStatus(status: string | undefined): {
  contractStatus?: 'SIGNED' | 'DECLINED' | 'VOID' | 'SENT' | 'VIEWED';
} {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return { contractStatus: 'SIGNED' };
    case 'declined':
      return { contractStatus: 'DECLINED' };
    case 'voided':
      return { contractStatus: 'VOID' };
    case 'delivered':
      return { contractStatus: 'VIEWED' };
    case 'sent':
      return { contractStatus: 'SENT' };
    default:
      return {};
  }
}
