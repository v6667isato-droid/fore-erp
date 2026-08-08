import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Manrope } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Føre Furniture | ERP",
  description: "Handcrafted solid wood furniture workshop management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var c=localStorage.getItem('colorTheme');var l=localStorage.getItem('theme');if(!c){c=l==='dark'?'dark':(l?'default':(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'default'));}else{if(c==='indigo')c='ink';if(l==='dark')c='dark';}var valid=['default','dark','ink','forest','mono','mauve'];if(valid.indexOf(c)<0)c='default';if(l!==null)localStorage.removeItem('theme');localStorage.setItem('colorTheme',c);if(c!=='default')d.setAttribute('data-theme',c);else d.removeAttribute('data-theme');}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${manrope.variable} ${inter.className} antialiased`}
      >
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
