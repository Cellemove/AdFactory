"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { ROLE_LABELS, type Role } from "@/lib/roles";

type NavLink = { href: string; label: string };

// Primary tabs stay on the bar; everything else lives under the "Other" dropdown.
const PRIMARY: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/spy", label: "Spy" },
  { href: "/verbatims", label: "Verbatims" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/avatars", label: "Avatars" },
  { href: "/reviews", label: "Reviews" },
];

const OTHER: NavLink[] = [
  { href: "/research", label: "Research" },
  { href: "/excavate", label: "Excavate (G1)" },
  { href: "/broll", label: "B-roll" },
  { href: "/new", label: "New Run" },
  { href: "/script", label: "Script" },
  { href: "/winners", label: "Winners" },
  { href: "/runs", label: "Runs" },
  { href: "/big-swings", label: "Big Swings" },
  { href: "/swipe-file", label: "Swipe File" },
  { href: "/agents", label: "Agents" },
  { href: "/usage", label: "Usage" },
  { href: "/about", label: "About" },
  { href: "/settings", label: "Settings" },
];

function isActive(path: string | null, href: string): boolean {
  return href === "/" ? path === "/" : Boolean(path?.startsWith(href));
}

export function Nav({ username, role = "creative_strategist" }: { username?: string | null; role?: Role }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEditor = role === "editor";

  // Close the dropdown on outside click, Escape, or route change.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const otherActive = OTHER.some((l) => isActive(path, l.href));
  const tabClass = (active: boolean) =>
    `rounded-md px-2.5 py-1 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 ${
      active ? "bg-ink-900 text-white shadow-sm" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-5 w-5 rounded-sm bg-brand-pink" />
          <span className="text-sm font-semibold tracking-tight">AdFactory</span>
        </Link>
        <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
          {isEditor ? (
            <Link href="/reviews" className={tabClass(isActive(path, "/reviews"))}>
              Reviews
            </Link>
          ) : (
            PRIMARY.map((l) => (
              <Link key={l.href} href={l.href} className={tabClass(isActive(path, l.href))}>
                {l.label}
              </Link>
            ))
          )}

          {/* Other Tabs dropdown (strategists only) */}
          {!isEditor && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={open}
              className={`${tabClass(otherActive)} inline-flex items-center gap-1`}
            >
              Other
              <span className={`text-[10px] transition ${open ? "rotate-180" : ""}`}>▾</span>
            </button>
            {open && (
              <div
                role="menu"
                className="menu-pop absolute left-0 top-full z-40 mt-1.5 min-w-44 rounded-lg border border-ink-200 bg-white py-1.5 shadow-pop"
              >
                {OTHER.map((l) => {
                  const active = isActive(path, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      role="menuitem"
                      className={`mx-1.5 block rounded-md px-2.5 py-1.5 text-sm transition ${
                        active ? "bg-ink-100 font-medium text-ink-900" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                      }`}
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </nav>
        <div className="flex items-center gap-3">
          {!isEditor && (
            <Link href="/new" className="btn btn-primary">
              + New Run
            </Link>
          )}
          {username && (
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] font-medium uppercase tracking-wide text-ink-400 sm:inline">
                {ROLE_LABELS[role]}
              </span>
              <span className="hidden max-w-[12rem] truncate text-xs text-ink-500 lg:inline" title={username}>
                @{username}
              </span>
              <form action={signOut}>
                <button type="submit" className="btn text-xs">
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
