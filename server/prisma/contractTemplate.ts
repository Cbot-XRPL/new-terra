// Default residential construction contract template body. Loaded by both
// the bootstrap seed (seed.ts) and the demo seed (seed-demo.ts) so a fresh
// install lands with a usable starter template.
//
// Variables use {{snake_case}} placeholders. The contract editor surfaces
// each variable defined in `variables` below so the sales rep fills them
// at creation time. The {{draw_schedule}} placeholder is auto-rendered from
// the Draw schedule attached to the contract — sales doesn't fill it by
// hand.
//
// EDIT THIS BODY in the Templates page once you can paste your real
// contract wording — the seed only writes it on first install.

export const STANDARD_CONTRACT_BODY = `RESIDENTIAL CONSTRUCTION AGREEMENT

This Agreement is entered into on {{contract_date}} between:

  CONTRACTOR:  New Terra Construction
               License #: {{license_number}}
               Address:   {{contractor_address}}

  OWNER:       {{customer_name}}
               Address:   {{customer_address}}

for the work described below at the property located at {{project_address}}
("the Project").

1. SCOPE OF WORK

The Contractor agrees to furnish all labor, materials, equipment, and
services necessary to complete the following work in a good and workmanlike
manner:

{{scope_of_work}}

2. CONTRACT PRICE

The total Contract Price for the work described above is
{{contract_total}} (USD), subject to written change orders signed by both
parties.

3. DRAW SCHEDULE / PAYMENT TERMS

The Owner shall pay the Contract Price in accordance with the following
draw schedule. Each draw becomes due upon completion of the corresponding
milestone. Invoices for each draw will be issued through the customer
portal and are payable within {{payment_terms_days}} days of issuance.

{{draw_schedule}}

A {{deposit_percent}}% deposit is required at signing and is included in
the schedule above.

4. SCHEDULE

The Contractor shall begin work on or about {{start_date}} and shall
substantially complete the work on or about {{substantial_completion_date}},
subject to delays caused by weather, supply chain, change orders, or other
events outside the Contractor's reasonable control.

5. CHANGE ORDERS

Any addition, deletion, or modification to the Scope of Work shall be
documented in a written Change Order signed by both parties. No changes
shall be performed without a signed Change Order, which shall set forth any
adjustment to the Contract Price and the schedule.

6. WARRANTIES

Contractor warrants that all workmanship will be free from defects for a
period of one (1) year from substantial completion. Manufacturer warranties
on materials and equipment are passed through to the Owner. Routine wear
and tear, neglect, abuse, or damage caused by parties other than Contractor
are excluded.

7. INSURANCE & LIABILITY

Contractor shall maintain general liability and workers' compensation
insurance throughout the duration of the work. Certificates of insurance
will be provided to the Owner upon request.

8. PERMITS & INSPECTIONS

Contractor shall obtain all permits and inspections required by the local
jurisdiction. The cost of permits is included in the Contract Price unless
specifically excluded in the Scope of Work.

9. LIEN RIGHTS

Owner acknowledges that Contractor and any subcontractors or material
suppliers furnishing labor or materials to the Project may have lien
rights against the property in the event of non-payment, as permitted
under applicable state law.

10. TERMINATION

Either party may terminate this Agreement upon material breach by the
other, after providing written notice and a reasonable opportunity to
cure. Upon termination, Owner shall pay Contractor for all work completed
through the termination date plus any non-cancellable material orders.

11. DISPUTE RESOLUTION

The parties agree to first attempt in good faith to resolve any dispute
arising under this Agreement through direct negotiation. If unresolved,
disputes shall be submitted to mediation, and if still unresolved, to
binding arbitration under the rules of the American Arbitration
Association in {{jurisdiction}}.

12. ENTIRE AGREEMENT

This Agreement, together with the attached estimate and any signed Change
Orders, constitutes the entire agreement between the parties and
supersedes any prior verbal or written understandings. It may be amended
only by a writing signed by both parties.

SIGNATURES

By signing below, the parties acknowledge they have read, understood, and
agree to the terms of this Agreement.

  Owner:       {{customer_name}}
  Date:        ____________________

  Contractor:  New Terra Construction
  Date:        ____________________
`;

// Variables surfaced in the contract editor. {{draw_schedule}} is omitted
// because it's auto-rendered from the Draw rows attached to the contract.
export const STANDARD_CONTRACT_VARIABLES = [
  { key: 'contract_date', label: 'Contract date', required: true },
  { key: 'license_number', label: 'Contractor license number', required: false },
  { key: 'contractor_address', label: 'Contractor address', required: false },
  { key: 'customer_name', label: 'Customer / Owner name', required: true },
  { key: 'customer_address', label: 'Customer / Owner address', required: true },
  { key: 'project_address', label: 'Project property address', required: true },
  { key: 'scope_of_work', label: 'Scope of work', required: true, multiline: true },
  { key: 'contract_total', label: 'Contract total ($)', required: true },
  { key: 'payment_terms_days', label: 'Payment terms (days)', required: false },
  { key: 'deposit_percent', label: 'Deposit %', required: false },
  { key: 'start_date', label: 'Start date', required: false },
  { key: 'substantial_completion_date', label: 'Substantial completion date', required: false },
  { key: 'jurisdiction', label: 'Jurisdiction (for arbitration)', required: false },
];
