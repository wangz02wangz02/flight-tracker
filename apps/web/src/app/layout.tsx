import type { Metadata } from 'next';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flight Tracker',
  description: 'Real-time global flight tracking. Built with Next.js, Supabase Realtime, and Clerk.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen flex flex-col">
          <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 backdrop-blur sticky top-0 z-40">
            <Link href="/" className="font-semibold tracking-wide text-sky-100 hover:text-sky-300 transition-colors">
              <span className="inline-block mr-1">✈️</span> Flight Tracker
            </Link>
            <nav className="flex items-center gap-5 text-sm">
              <SignedIn>
                <Link
                  href="/map"
                  className="text-slate-300 hover:text-sky-400 transition-colors"
                >
                  Map
                </Link>
                <Link
                  href="/favorites"
                  className="text-slate-300 hover:text-sky-400 transition-colors"
                >
                  Favorites
                </Link>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 transition-colors">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 transition-colors shadow-sm shadow-sky-900/40">
                    Sign up
                  </button>
                </SignUpButton>
              </SignedOut>
            </nav>
          </header>
          <main className="flex-1 flex flex-col">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
