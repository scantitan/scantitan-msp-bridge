# ScanTitan partner readiness — 2 November 2026

Contact, support and listing email: **info@scantitan.com**. Product: https://scantitan.com/. Pilot documentation and download: https://portal.scantitan.com/integrations/msp.html.

## Priority and current evidence

| Order | Platform | Delivered | Remaining release gate |
| --- | --- | --- | --- |
| 1 | Acronis | Operator-hosted alert adapter, tenant bindings, deterministic references, recovery and guarded dismissal | Vendor account, registered CyberApp extensions and alert schema, native enablement/disablement callbacks, live sandbox acceptance, catalogue approval |
| 2 | HaloPSA | Customer/site-bound ticket adapter, duplicate recovery, priority updates and optional resolution | Dedicated tenant application, actual permission scopes and workflow IDs, live tenant acceptance, TAP review |
| 3 | ConnectWise PSA | ScanTitan event preview and read-only API check | Approved Developer Network access, full service-ticket schema, sandbox, write adapter, Marketplace review |
| 4 | N-able | Product and partner-program assessment | Confirm N-central as first product with TAP team, acquire test instance and verify supported monitoring ingestion |
| 5 | Kaseya | Product and partner-program assessment | Confirm Autotask route and public-integration eligibility, relevant agreement, tracking ID, sandbox |

No new partner application has been submitted, agreement accepted, account created or certification claimed by this release. Acronis registration has been opened with the known company and public email prepared. Named contact, telephone, registered country, company type and headcount are unverified and must not be invented.

## Ready-to-use product description

ScanTitan helps MSPs, MSSPs, agencies and internal security teams assess website security and review ongoing observations within their ScanTitan plan. The MSP bridge delivers selected website finding changes to explicitly mapped vendor customers. It uses read-only, website-scoped ScanTitan credentials, stable finding references and a protected delivery journal. The bridge does not provision customers, start scans, install website agents or grant additional monitoring allowances. The bridge is free to install; connected-app access requires an active ScanTitan Business or Consultant plan. Consultant does not include ongoing monitoring.

Proposed listing title: **ScanTitan Website Security**. Proposed category: website security / security operations; final category depends on the vendor's available taxonomy. Do not describe the pilot as certified, native, generally available or listed before the relevant acceptance.

## Acronis — next actions

1. Complete the [Technology Ecosystem application](https://developer.acronis.com/en-us/#register) with the actual legal company and named contact. Account activation, password/2FA and program agreement acceptance require the account owner. No substitute identities or unattended acceptance.
2. Follow [CyberApp onboarding](https://developer.acronis.com/doc/cyberapps/getting-started/index.html). Request a vendor sandbox, the correct application identification, permitted API client and assigned namespace. Do not publish guessed CTI identifiers.
3. Configure a website-security alert category and type in Vendor Portal. Validate the actual registered detail schema against `src/adapters/acronis.mjs`; adapt only to confirmed vendor requirements. Current public contract metadata is in `contracts/acronis.json`.
4. Implement native enablement, mapping, health and disablement callbacks only after the CyberApp lifecycle contract is confirmed. Verify Acronis-signed requests, tenant identity and installation ownership. The current package is the event-delivery component and exposes no callback endpoint.
5. Run the acceptance matrix below with two isolated customer tenants and at least two simultaneous findings. Record vendor version, assigned CTIs and the evidence without secrets. Confirm how repeated alert updates and severity changes behave.
6. Submit the reviewed description, logo, privacy/support links, setup guide and sanitized demonstration to catalogue review. Keep automatic resolution off until the customer approves its behaviour.

Technical sources: [alert delivery](https://developer.acronis.com/doc/connector/managing-alerts/reporting-alerts/index.html), [Alert Manager OpenAPI](https://developer.acronis.com/doc/alerts/v1/reference/openapi.json), [client authentication](https://developer.acronis.com/doc/outbound/apis/authentication/authentication.html). The documentation and current OpenAPI differ on tenant filtering for dismissal; the bridge verifies ownership with GET, then uses exact alert-ID and type filters supported by the contract.

## HaloPSA — next actions

The current [Halo TAP page](https://www.usehalo.com/partner/contact-tap) advertises free enablement, certification, demo account and support. Its form asks for first/last name, company email, telephone, company, product and a description. Use the verified company details and product description above. A named contact and telephone still need owner input. Form submission states agreement to its privacy policy; it has not been submitted.

Request a HaloPSA demo tenant and technical review of customer/site-mapped security tickets. In the tenant, obtain API Details, a dedicated application and the actual OAuth scope names. Validate ticket type, open/resolution status and priority IDs. Review notification rules and technician assignment before test delivery. Test the exact installed version's API; the public [documentation](https://halo.haloservicedesk.com/apidoc) is a reference rather than proof of tenant compatibility.

## ConnectWise — next actions

Apply as a **Solutions Partner** using info@scantitan.com at the [Developer Network](https://developer.connectwise.com/Best_Practices/Getting_Started). Explain that this is a public ScanTitan-to-PSA integration, rather than an internal one-customer script. Request full PSA REST documentation, client ID and a developer test instance. No developer account, client ID or credentials are currently available to this task.

Obtain the actual schemas for service tickets, company/site relationships, boards, statuses, priorities, notes and recovery search. Then implement writes and cross-customer verification behind a new version and repeat the acceptance matrix. The public independent-publisher example lacks a complete ticket schema, so writes remain disabled. Marketplace approval and Invent certification are separate tracks; do not imply that either follows automatically from Developer Network registration. Current fees and contract terms require a vendor quote/review; no paid enrollment is authorized or purchased here.

## N-able assessment

Recommended first route: **N-central**, subject to partner confirmation that external website incidents fit its supported custom-monitoring model. N-sight, Cove, Take Control and other products have distinct APIs; a generic “N-able connector” would hide important compatibility differences. Use the [Developer Portal](https://developer.n-able.com/) and [Technology Alliance Program](https://www.n-able.com/partnerships/technology-alliance-program/join) to request the appropriate API guidance, test software and directory review.

The program advertises development resources, test/training software and directory visibility. This supports pursuing N-able after the three requested priorities. It does not establish integration approval or a guaranteed audience for ScanTitan. No fee assumption, device-control implementation or public callback endpoint has been made.

Before implementation, confirm a supported customer-scoped incident/monitor ingestion route, version compatibility, authentication, rate limits and resolution semantics. Prefer a narrow read/reporting integration over adding endpoint commands. Proceed when a test tenant and an MSP pilot customer are available.

## Kaseya assessment

Recommended first route: **Autotask PSA** tickets, followed by a separate Datto RMM/VSA assessment only if customer demand supports it. This is a product-fit recommendation, not a claim that a Kaseya connector is implemented.

The current [API License and Confidentiality Agreement](https://www.kaseya.com/legal/kaseya-api-license/) distinguishes private from public integrations and directs public Autotask integrations to Integration Hub, other products to TAP. It also describes developer/sandbox access through the relevant agreement. Obtain Kaseya's confirmation of eligibility, current fees and any restrictions relevant to ScanTitan before development against a private API or public distribution. Do not assume a free public connector avoids program requirements. No license or alliance agreement has been accepted and no Kaseya API has been called.

## Vendor acceptance matrix

Use labeled synthetic websites and isolated vendor customers, not production customer evidence.

| Case | Expected result / evidence |
| --- | --- |
| Source permission and subscription | Free/Professional denied; Business/Consultant read-only; downgraded, expired and disconnected credentials rejected |
| First delivery | Default first run imports no history; one new qualifying finding creates one correctly bound alert/ticket |
| Customer isolation | A wrong tenant, wrong Halo site/client pair, changed website customer or mismatched remote reference stops delivery |
| Multiple findings | Two findings on one website retain distinct remote references; a second customer remains separate |
| Restart/replay | Repeated page and process restart produce no additional record |
| Lost acknowledgement | Remote create succeeds but connection drops; next run finds the exact original reference; no blind duplicate |
| Ambiguous recovery | No match, multiple matches or wrong customer stops until verified reconciliation |
| Severity/lifecycle | Existing issue priority updates; stale observation does not reopen a newer resolution; manual technician text preserved |
| Resolution | Off by default; enabled resolution affects only the bound issue; partial/failed assessments never imply recovery |
| Sample/legacy events | Sample findings, completion messages and legacy monitor records without an incident identity create no live records |
| Operational failure | Rate limit, timeout, credential expiry and corrupt journal retain state and emit no credentials |
| Disablement | Revoke source connection and confirm no further delivery; native Acronis disablement still requires implementation and acceptance |

Local evidence: 36 bridge tests, including a real CLI over isolated HTTPS with certificate verification enabled; 49 ScanTitan API tests with 376 assertions; TypeScript check and portal production build. These checks are not live vendor acceptance.

## Adoption after acceptance

Pilot Acronis first with one MSP and two test tenants, then HaloPSA with one service team. Keep a separate journal/credential for each installation. Track installation → successful preview → verified mapping → first acknowledged delivery → seven-day active delivery. Review duplicate rate, rejected customer mappings, delivery failures and operator time before expanding. Do not collect customer findings into a separate marketing analytics store. Marketplace traffic and installed-package counts alone do not demonstrate useful ScanTitan usage.
