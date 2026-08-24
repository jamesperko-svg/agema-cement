AGEMA Cement Platform - Toledo Hosted V2

Changes:
- Automatically checks the Federal Reserve Bank of New York SOFR feed on app use.
- Manual Refresh SOFR button.
- Preserves last stored SOFR if the Fed feed is unavailable.
- Audited base-cost bridge showing every cargo and MidWest terminal cost component.
- Editable Available Ready-Mix selling price and payment terms.
- Existing editable cargo assumptions and variable throughput schedule retained.

Deployment over existing Vercel project:
1. Replace the files in your local agema_vercel_v1 folder with the files in this package.
2. From that folder run: npx vercel --prod
No new Vercel environment variables are required.
