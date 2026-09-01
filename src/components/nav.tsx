"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { LogoMark } from "@/components/logo";
import { ROLE_LABELS, type Role } from "@/lib/roles";

type NavLink = { href: string; label: string };

// Primary tabs stay on the bar; everything else lives under the "Other" dropdown.
const PRIMARY: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/scripts", label: "Scripts" },
  { href: "/products", label: "Products" },
  { href: "/spy", label: "Spy" },
  { href: "/bank", label: "Idea Bank" },
  { href: "/verbatims", label: "Verbatims" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/avatars", label: "Avatars" },
  { href: "/broll", label: "B-roll" },
  { href: "/reviews", label: "Reviews" },
];

const OTHER: NavLink[] = [
  { href: "/research", label: "Research" },
  { href: "/winners", label: "Winners" },
  { href: "/runs", label: "History" },
  { href: "/big-swings", label: "Big Swings" },
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
    `rounded-full px-3 py-1 transition duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 ${
      active ? "bg-ink-900 text-white shadow-sm" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
    }`;

  return (
    // Floating glass island, detached from the viewport edge.
    <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 rounded-2xl border border-ink-200/70 bg-white/80 px-4 py-2.5 shadow-card backdrop-blur-xl sm:px-5">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="h-5 w-5" />
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
                className="menu-pop absolute left-0 top-full z-40 mt-1.5 min-w-44 rounded-xl border border-ink-200/70 bg-white/95 py-1.5 shadow-pop backdrop-blur-xl"
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
