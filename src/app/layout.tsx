import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { getSessionUser } from "@/lib/auth";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CelluMove Ad Factory",
  description: "Avatar research + brief → 25 production-ready static-ad prompts.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser();

  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <div className="flex min-h-[100dvh] flex-col">
          {/* No nav on the login screen (middleware keeps everything else gated). */}
          {session && <Nav username={session.username} role={session.role} />}
          <main className={session ? "mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6" : "flex-1"}>{children}</main>
          <footer className="border-t border-ink-200 bg-white py-3 text-center text-xs text-ink-400">
            CelluMove Ad Factory · prompts-only · Image gen lands in Phase 5
          </footer>
        </div>
      </body>
    </html>
  );
}
