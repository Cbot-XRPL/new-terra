// docusign-esign ships without TypeScript types of its own. We declare the
// surface we actually call so the rest of the codebase stays strict.
declare module 'docusign-esign' {
  export class ApiClient {
    setBasePath(p: string): void;
    setOAuthBasePath(p: string): void;
    addDefaultHeader(name: string, value: string): void;
    requestJWTUserToken(
      clientId: string,
      userId: string,
      scopes: string[],
      rsaPrivateKey: Buffer | string,
      jwtLifeSec: number,
    ): Promise<{ body: { access_token: string; expires_in?: number } }>;
  }

  // Constructor helpers from docusign-esign use a shared shape.
  interface FromObject<T> {
    constructFromObject(obj: Record<string, unknown>): T;
  }

  export class Document {
    documentBase64?: string;
    name?: string;
    fileExtension?: string;
    documentId?: string;
  }

  export interface SignerType {
    tabs?: TabsType;
  }
  export const Signer: FromObject<SignerType>;

  export interface SignHereType {}
  export const SignHere: FromObject<SignHereType>;

  export interface TabsType {
    signHereTabs?: SignHereType[];
  }
  export const Tabs: FromObject<TabsType>;

  export interface RecipientsType {}
  export const Recipients: FromObject<RecipientsType>;

  export interface TextCustomFieldType {}
  export const TextCustomField: FromObject<TextCustomFieldType>;

  export interface CustomFieldsType {}
  export const CustomFields: FromObject<CustomFieldsType>;

  export class EnvelopeDefinition {
    emailSubject?: string;
    documents?: Document[];
    recipients?: RecipientsType;
    status?: string;
    customFields?: CustomFieldsType;
  }

  export class EnvelopesApi {
    constructor(client: ApiClient);
    createEnvelope(
      accountId: string,
      params: { envelopeDefinition: EnvelopeDefinition },
    ): Promise<{ envelopeId?: string; status?: string }>;
  }

  const _default: {
    ApiClient: typeof ApiClient;
    Document: typeof Document;
    Signer: typeof Signer;
    SignHere: typeof SignHere;
    Tabs: typeof Tabs;
    Recipients: typeof Recipients;
    TextCustomField: typeof TextCustomField;
    CustomFields: typeof CustomFields;
    EnvelopeDefinition: typeof EnvelopeDefinition;
    EnvelopesApi: typeof EnvelopesApi;
  };
  export default _default;
}
