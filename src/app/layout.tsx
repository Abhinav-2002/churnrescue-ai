import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChurnRescue AI",
  description: "Autonomous billing recovery agent",
};

import { ChatProvider } from "@/components/ChatContext";
import { ChatWidget } from "@/components/ChatWidget";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let themeClass = "";
  try {
    const cookieStore = await cookies();
    const themeCookie = cookieStore.get("theme")?.value;
    if (themeCookie === "dark") {
      themeClass = "dark";
    } else if (themeCookie === "light") {
      themeClass = "light";
    }
  } catch {
    // In build phase, cookies() might throw or return empty
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${themeClass} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ChatProvider>
          {children}
          <ChatWidget />
        </ChatProvider>
      </body>
    </html>
  );
}

