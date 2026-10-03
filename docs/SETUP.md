# Setup

## PayPal Sandbox Setup
1. Log in to the [PayPal Developer Dashboard](https://developer.paypal.com/).
2. Navigate to **Apps & Credentials** and select the **Sandbox** toggle.
3. Click **Create App**, give it a name (e.g., ChurnRescue AI), and select **Merchant** as the type.
4. Once created, copy the **Client ID** and **Secret**.
5. Add these to your `.env` file (see `.env.example`).
6. **Enable Negative Testing** ([Official Documentation](https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/)):
   - *(UNVERIFIED UI PATH, please check in your dashboard)* Go to **Sandbox** > **Accounts** in the Developer Dashboard.
   - Locate the business sandbox account linked to your app.
   - Click the **...** menu and select **View/Edit Account**.
   - Go to the **Settings** tab.
   - Toggle **Negative Testing** to **On**. This is required for the `INSTRUMENT_DECLINED` mock header to work.
