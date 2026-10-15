import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createWebsiteManually } from "@/app/website-actions";

export const dynamic = "force-dynamic";

/**
 * Add a website by hand.
 *
 * The bulk builder works backwards from domains that are already being paid
 * for, which covers the existing estate but not a site that has no recurring
 * services yet — a new build, or one hosted elsewhere. This is the way in for
 * those: create it, then attach or add services on the site's own page.
 */
export default async function NewWebsitePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; error?: string }>;
}) {
  const { clientId, error } = await searchParams;
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <div className="page-head">
        <h1>New website</h1>
        <Link href="/websites" className="btn btn-secondary">
          Back to websites
        </Link>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="card">
        <form action={createWebsiteManually} className="stack">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              required
              placeholder="example.co.uk"
              autoFocus
            />
            <span className="muted small">
              Usually the registrable domain — it&apos;s what matches this site to invoice lines and
              to services later.
            </span>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="url">URL</label>
              <input id="url" name="url" placeholder="https://example.co.uk" />
            </div>
            <div className="field">
              <label htmlFor="clientId">Client</label>
              <select id="clientId" name="clientId" defaultValue={clientId ?? ""}>
                <option value="">— unassigned —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="muted small">
                Needed before the site can be invoiced or reconciled. Can be set later.
              </span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="notes">Notes</label>
            <input id="notes" name="notes" placeholder="Hosted elsewhere, CMS, anything worth knowing" />
          </div>

          <div>
            <button type="submit" className="btn">
              Create website
            </button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              You&apos;ll land on the site&apos;s page to attach or add services.
            </span>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Already paying for the domain?</h2>
        <p className="muted">
          If this site&apos;s domain or hosting is already in the recurring register,{" "}
          <Link href="/websites/bulk">create from domains</Link> instead — it groups the domain,
          hosting and licences together for you rather than leaving them to attach by hand.
        </p>
      </div>
    </>
  );
}
