"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SearchResults = {
  projects: Array<{
    id: string;
    title: string;
    type: string;
    archived: boolean;
    client: { name: string };
  }>;
  websites: Array<{
    id: string;
    name: string;
    url: string | null;
    client: { name: string } | null;
  }>;
  clients: Array<{
    id: string;
    name: string;
    contactName: string | null;
    email: string | null;
  }>;
};

type SearchItem = {
  key: string;
  href: string;
  title: string;
  detail: string;
};

const EMPTY: SearchResults = { projects: [], websites: [], clients: [] };

export default function GlobalSearch() {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const groups = useMemo(
    () => [
      {
        label: "Projects",
        items: results.projects.map<SearchItem>((project) => ({
          key: `project-${project.id}`,
          href: `/projects/${project.id}`,
          title: project.title,
          detail: `${project.client.name} · ${project.type === "ADHOC" ? "Ad-hoc" : "Project"}${project.archived ? " · Archived" : ""}`,
        })),
      },
      {
        label: "Websites",
        items: results.websites.map<SearchItem>((website) => ({
          key: `website-${website.id}`,
          href: `/websites/${website.id}`,
          title: website.name,
          detail: website.client?.name ?? website.url ?? "No client assigned",
        })),
      },
      {
        label: "Clients",
        items: results.clients.map<SearchItem>((client) => ({
          key: `client-${client.id}`,
          href: `/clients/${client.id}`,
          title: client.name,
          detail: client.contactName ?? client.email ?? "Client",
        })),
      },
    ],
    [results],
  );
  const items = groups.flatMap((group) => group.items);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onShortcut);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onShortcut);
    };
  }, []);

  useEffect(() => {
    const value = query.trim();
    setActive(-1);
    if (value.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }

    setResults(EMPTY);
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Search failed");
        setResults((await response.json()) as SearchResults);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults(EMPTY);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      input.current?.blur();
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current <= 0 ? items.length - 1 : current - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      setOpen(false);
      router.push(items[active].href);
    }
  }

  const showPanel = open && query.trim().length >= 2;
  let itemIndex = -1;

  return (
    <div className="global-search" ref={root}>
      <label className="sr-only" htmlFor="global-search-input">
        Search projects, websites and clients
      </label>
      <span className="global-search-icon" aria-hidden="true">⌕</span>
      <input
        ref={input}
        id="global-search-input"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search…"
        autoComplete="off"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-activedescendant={active >= 0 ? `global-search-result-${active}` : undefined}
      />
      <kbd>⌘K</kbd>

      {showPanel && (
        <div className="global-search-panel" id="global-search-results" role="listbox">
          {loading && items.length === 0 ? (
            <p className="global-search-status">Searching…</p>
          ) : items.length === 0 ? (
            <p className="global-search-status">No matching projects, websites or clients.</p>
          ) : (
            groups.map((group) =>
              group.items.length ? (
                <section key={group.label} className="global-search-group">
                  <h2>{group.label}</h2>
                  {group.items.map((item) => {
                    itemIndex += 1;
                    const index = itemIndex;
                    return (
                      <Link
                        id={`global-search-result-${index}`}
                        role="option"
                        aria-selected={active === index}
                        className={active === index ? "active" : ""}
                        href={item.href}
                        key={item.key}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => setOpen(false)}
                      >
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </Link>
                    );
                  })}
                </section>
              ) : null,
            )
          )}
        </div>
      )}
    </div>
  );
}
