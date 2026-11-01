# ScanTitan MSP bridge 0.1.0

Support and maintainer: **info@scantitan.com**. The bridge is free to install. ScanTitan connected-app access requires an active **Business or Consultant** plan. Consultant does not include ongoing monitoring.

This operator-hosted Node.js bridge reads changes for explicitly selected ScanTitan websites and delivers them to an MSP's configured customer. It does not enroll customers, start scans, read private website files, or grant additional scan or monitoring allowances.

| Adapter | Release status |
| --- | --- |
| Acronis | Pilot implementation for registered CyberApp alert types. Native vendor-portal setup, sandbox acceptance and catalogue review remain required. |
| HaloPSA | Pilot implementation for customer/site-mapped tickets. Actual tenant credentials and live sandbox acceptance remain required. |
| ConnectWise PSA | Event preview and read-only authentication check. Ticket writes are disabled pending approved developer documentation and sandbox validation. |

These are not certified or listed integrations. Local fixture tests do not establish vendor approval or successful real-customer delivery.

## Configure

1. Install Node.js 24 or newer. Extract this package into a private directory. It has no runtime package dependencies.
2. In ScanTitan, open **Account & plan → Connected apps**. Choose the matching Acronis, HaloPSA or ConnectWise connection, select websites and grant **View selected websites** and **Read changes and incident events**. Create a separate credential for every bridge installation.
3. Copy the matching JSON file from `examples` into a private runtime directory. Replace its reserved example addresses and zero IDs using the vendor's configuration. Zero IDs intentionally fail validation.
4. Set the environment variables named in that JSON using your service manager or secret store. Store the ScanTitan credential only in `SCANTITAN_MSP_TOKEN`; never put credential values in the JSON, source control or command arguments.
5. Map each ScanTitan website ID to an exact Acronis customer tenant UUID, Halo client/site pair, or ConnectWise company/site pair. There is no automatic matching by website domain or customer name.
6. Run the preview and read-only configuration check. Review the selected customer mappings before enabling delivery.

```sh
node src/cli.mjs preview --config /private/bridge.json
node src/cli.mjs check --config /private/bridge.json
node src/cli.mjs run --config /private/bridge.json --apply
```

The first applied run saves a current event cursor and starts with **future events**. To deliberately include available historic events in a **new** journal, add `--replay`. This can create multiple external alerts or tickets. `--replay` never rewinds an existing journal.

Run the applied command periodically using a scheduler. A 60-second interval is a reasonable starting point for a small pilot; respect vendor rate limits and a reported `retryAfterSeconds` delay. Only one worker may own a state file. Keep the state directory private and back it up. Do not run independent journals for the same connection and destination: vendor ticket APIs do not offer an atomic shared deduplication guarantee.

## Acronis setup

Use the data-center origin assigned to your Acronis account, a permitted API client, and the application code assigned in Vendor Portal. Every Acronis request includes the configured application identification. Configure the **registered** alert type and category CTIs; this bridge does not register unapproved alert types or activate customer services.

The adapter uses client-credentials authentication, checks configured tenant IDs, posts alerts with deterministic UUIDs and a ScanTitan reference, and verifies the tenant/reference before an update or dismissal. Automatic resolution is off by default. If enabled, it validates the alert's customer and sends the exact alert ID and configured alert type as dismissal filters. It never performs a tenant-wide or category-wide dismissal.

Production acceptance must confirm the registered alert schema, multiple simultaneous findings, cross-customer isolation, severity handling, lifecycle updates and disablement. A native CyberApp additionally requires vendor-portal extension configuration and validated callback handling. This package is the event-delivery component, not a completed native CyberApp deployment.

Primary references: [Acronis alert delivery](https://developer.acronis.com/doc/connector/managing-alerts/reporting-alerts/index.html), [authentication](https://developer.acronis.com/doc/outbound/apis/authentication/authentication.html), [CyberApp onboarding](https://developer.acronis.com/doc/cyberapps/getting-started/index.html).

## HaloPSA setup

Read the resource and authentication URLs from **Configuration → Integrations → Halo API → API Details**. They may use different hosts. Create a dedicated services application with client ID and secret and the minimum permissions for the selected customers/sites and ticket operations. The bridge does not require global administrative access or a user's password. Configure the actual OAuth scope names and ticket type, priority and status IDs from your instance.

The adapter verifies that each site belongs to its configured customer. A bracketed `ST-…` reference in the ticket summary supports exact recovery searches across open and closed tickets. New tickets contain escaped finding information and a login-protected ScanTitan report link. Updates preserve the ticket description and technician notes; they adjust priority, optionally reopen a ticket previously resolved by this bridge, or apply an explicitly configured resolution status.

Tenant automation can send notifications when tickets change. Review the selected ticket type and rules during sandbox acceptance before real delivery. Keep `autoResolve` false until your team has approved the resolution workflow. Findings missing from a failed or partially covered assessment are not resolution signals.

Primary reference: [Halo's API documentation](https://halo.haloservicedesk.com/apidoc), with contract metadata in `contracts/halopsa.json` in the source distribution. Your tenant's own API documentation is authoritative for its installed version and customisation.

## ConnectWise preparation

Register for approved [ConnectWise Developer Network access](https://developer.connectwise.com/Best_Practices/Getting_Started). Obtain the appropriate client ID and a dedicated API member with scoped permissions. Preview needs only the ScanTitan credential; the read-only connection check uses the configured ConnectWise public/private API keys and company code.

**Ticket writes remain disabled in this release.** A public independent-publisher connector exposes ticket-list/create routes but does not include a complete ticket payload schema. It is not sufficient evidence for live write compatibility. Complete the approved schema review and sandbox acceptance before enabling those operations in a later release.

## Recovery and limits

Event delivery is replayable. The cursor advances only after a page's accepted deliveries have been checkpointed. Acknowledged event IDs and stable issue bindings survive restarts. Changes to installation identity, destination routing or website/customer bindings stop delivery instead of silently reusing old mappings. A credential rotation for the same installation retains state.

A lost create response leaves a pending record. The next run searches for the original ScanTitan reference. If it cannot confirm an existing record, it **stops** rather than blindly creating another. Check the vendor console, preserve the journal and reconcile a confirmed record:

```sh
node src/cli.mjs reconcile --config /private/bridge.json --reference ST_REFERENCE --remote-id CONFIRMED_ID --apply
```

Use the exact bracket-free `ST-` reference printed by preview or recorded in the protected journal. The command validates the vendor/customer/reference relationship before accepting the ID. It does not create, delete or close an external record.

Unclean termination can leave a `.lock` file. Confirm that the recorded process is stopped before removing that one lock file. Never delete the journal to clear an error. Incorrect or corrupt state is retained for recovery.

The pilot supports up to 200 explicitly mapped websites and 20,000 tracked issues per journal, with a 32 MiB journal limit and at most 20 event pages per run. A larger deployment needs a reviewed database-backed worker design. Medium-and-higher observations are selected by default. Sample results and scan-completion messages do not create tickets; legacy monitoring events without stable incident identities are skipped. Current monitoring events have a stable, redacted incident identity.

The bridge sends titles, severity, redacted locations, observation times and report links. It does not send raw scan evidence, website credentials, query values or URL fragments. Review data-transfer requirements for your customers and destination vendor before applying a connection. API authentication and TLS validation remain enabled; redirects are refused.

## Development

```sh
npm test
node --check src/cli.mjs
```

Tests require OpenSSL to create a temporary, process-scoped HTTPS fixture certificate; it is never installed in the machine trust store. Unit and protocol fixtures use labeled synthetic data. They cover application/plan/scopes, customer isolation, replay, acknowledgement loss, exact recovery, state locking, severity changes and held/automatic resolution. Vendor sandbox and marketplace acceptance are separate release gates.

Public source and issue tracker: https://github.com/scantitan/scantitan-msp-bridge. Hosted checks exercise synthetic data on Linux and Windows; they do not establish real vendor acceptance.
