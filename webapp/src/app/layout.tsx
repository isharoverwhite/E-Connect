/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { Metadata } from "next";
import { Inter, Fira_Code, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import { ToastProvider } from "@/components/ToastContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageContext";
import MqttWarningBanner from "@/components/MqttWarningBanner";
import WifiWarningBanner from "@/components/WifiWarningBanner";
import { AppEventListener } from "@/components/AppEventListener";
import { FaviconController } from "@/components/FaviconController";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fira_code = Fira_Code({ subsets: ["latin"], variable: "--font-fira-code" });
const jetbrains_mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "E-Connect Dashboard",
  description: "IoT Home Control System",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "E-Connect",
  },
  other: {
    "theme-color": "#3b82f6",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
      </head>
      <body className={`${inter.variable} ${fira_code.variable} ${jetbrains_mono.variable} font-sans antialiased bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-200 selection:bg-primary selection:text-white`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <LanguageProvider>
            <AuthProvider>
              <ToastProvider>
                <AppEventListener />
                <FaviconController />
                <MqttWarningBanner />
                <WifiWarningBanner />
                {children}
              </ToastProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(function(){});
          }
        `}</Script>
      </body>
    </html>
  );
}
