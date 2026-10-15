## Environment Variables
Required variables for deployment:
- PAYPAL_CLIENT_ID 
- PAYPAL_CLIENT_SECRET 
- PAYPAL_BASE_URL (e.g. https://api-m.sandbox.paypal.com)
- NEXT_PUBLIC_PAYPAL_CLIENT_ID 
- GOOGLE_CLOUD_PROJECT 
- GOOGLE_CLOUD_LOCATION (global)
- LLM_MODEL 
- GOOGLE_CREDENTIALS_JSON 
- DEMO_MODE (1)
- DAILY_LLM_CALL_LIMIT (500)

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Prerequisites
- **Node.js**: Node 22 or newer is required (`>=22`).
- **Native C++ Build Tools (`better-sqlite3`)**:
  - `better-sqlite3` compiles native C++ bindings using `node-gyp` during `npm ci` / `npm install`.
  - **Native Windows**: You must install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select the **"Desktop development with C++"** workload (including MSVC v143 and Windows 10/11 SDK). Python 3.10+ must also be available on PATH.
  - **Alternative Development Environments**: If you prefer not to install the native Windows C++ toolchain, run the project inside **WSL2** (Windows Subsystem for Linux, Ubuntu) with `build-essential` installed, or in a **Docker** container based on `node:22-bookworm` or `node:22-alpine`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Demo Limitation
For the hosted judging demo, the application uses a single shared SQLite database. If two judges use the demo simultaneously, running `Reset` will wipe the session for both. It is recommended to coordinate or be aware of this behavior during evaluation.

