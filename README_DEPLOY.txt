AGEMA CEMENT PLATFORM - VERCEL / SUPABASE
=========================================

This app is the hosted Toledo version of the AGEMA Cement Decision Platform.
It reads/writes the Supabase tables already created in your AGEMA Cement Platform project.

IMPORTANT SECURITY RULE
Do NOT send your Supabase service-role key, database password, AGEMA password, or session secret to ChatGPT.
Enter them only in Vercel's Environment Variables screen.

REQUIRED VERCEL ENVIRONMENT VARIABLES
1. SUPABASE_URL
   Supabase -> Project Settings -> API -> Project URL

2. SUPABASE_SERVICE_ROLE_KEY
   Supabase -> Project Settings -> API -> service_role / secret key
   Keep this private. Never put it into browser/client-side code.

3. AGEMA_APP_PASSWORD
   Choose the password you want to use to open the AGEMA website.

4. AGEMA_SESSION_SECRET
   Choose a different long random string (32+ characters recommended).

DEPLOY WITH VERCEL CLI ON MAC
1. Unzip this folder.
2. Open Terminal.
3. Type: cd 
   Then drag the unzipped agema_vercel_v1 folder into Terminal and press Return.
4. Run: npx vercel
5. If asked to install Vercel, answer y.
6. Log into Vercel if requested.
7. Accept the default project setup answers.
8. In Vercel.com, open the new project -> Settings -> Environment Variables.
9. Add all four variables listed above for Production, Preview, and Development.
10. Return to Deployments and redeploy the project.
11. Open the production URL. You should see the AGEMA password screen.

DATABASE NOTES
- The app expects one market named Toledo.
- It uses cargoes, customers, terminal_rates, throughput_periods, latest_sofr, and financing_settings.
- It uses the MidWest rates already loaded into Supabase.
- It assumes two 12-hour dockage periods in the modeled fixed vessel cost, matching the current V2 planning logic.
- The current SOFR row is a temporary test value until the NY Fed feed is automated.

IPHONE
After deployment, open the production URL in Safari. Use Share -> Add to Home Screen if you want AGEMA to behave like an app icon.
