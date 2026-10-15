import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { xeroItemStatus, applyDefaultItemCodes } from "@/app/xero-item-actions";
import { serviceKindLabel } from "@/lib/recurring";
import { dateFmt } from "@/lib/status";
import ItemSync from "./ItemSync";
import MapForm from "./MapForm";

export const dynamic = "force-dynamic";

export default async function XeroItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; defaults?: string }>;
}) {
  const { tab, saved, defaults } = await searchParams;
  const showRecurring = tab === "recurring";

  const [status, items, services, recurring] = await Promise.all([
    xeroItemStatus(),
    prisma.xeroItem.findMany({ orderBy: { code: "asc" } }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true, price: true, unit: true, xeroItemCode: true },
    }),
    prisma.recurringService.findMany({
      where: { active: true },
      orderBy: [{ kind: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        kind: true,
        sellPrice: true,
        xeroItemCode: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>Xero products</h1>
        <Link href="/settings" className="btn btn-secondary">
          Back to settings
        </Link>
      </div>

      {saved && <div className="success-msg">Saved {saved} mapping(s).</div>}
      {defaults && (
        <div className="success-msg">
          Applied the standard code to {defaults} service(s) that had none.
        </div>
      )}

      <div className="card">
        <h2>The product list</h2>
        <p className="muted">
          Xero&apos;s products are copied here once, then everything below works offline — no API
          calls while you map. Setting the right product on a line from the start is what stops Xero
          overwriting your wording: change an item on an invoice in Xero and it replaces the
          description and price with the product&apos;s own.
        </p>
        <div className="stats">
          <div className="stat">
            <div className="label">Products cached</div>
            <div className="value">{status.total}</div>
            <div className="muted">
              {status.lastSyncedAt ? <>synced {dateFmt(status.lastSyncedAt)}</> : "never synced"}
            </div>
          </div>
          <div className="stat">
            <div className="label">Price list mapped</div>
            <div className="value">
              {status.mappedServices}/{status.totalServices}
            </div>
            <div className="muted">services with a product</div>
          </div>
          <div className="stat">
            <div className="label">Recurring mapped</div>
            <div className="value">
              {status.mappedRecurring}/{status.totalRecurring}
            </div>
            <div className="muted">domains, hosting, O365, care plans</div>
          </div>
        </div>
        <ItemSync total={status.total} />
      </div>

      {status.total === 0 ? (
        <div className="card">
          <p className="muted">
            Sync the product list above before mapping — the dropdowns are filled from the cache.
          </p>
        </div>
      ) : (
        <>
          <div className="filters">
            <Link href="/settings/xero-items" className={!showRecurring ? "active" : ""}>
              Price list ({status.totalServices})
            </Link>
            <Link href="/settings/xero-items?tab=recurring" className={showRecurring ? "active" : ""}>
              Recurring services ({status.totalRecurring})
            </Link>
          </div>

          {showRecurring ? (
            <MapForm
              mode="recurring"
              items={items}
              rows={recurring.map((r) => ({
                id: r.id,
                name: r.label,
                group: serviceKindLabel(r.kind),
                detail: r.client?.name ?? "unassigned",
                price: r.sellPrice,
                code: r.xeroItemCode,
              }))}
              defaultsAction={applyDefaultItemCodes}
            />
          ) : (
            <MapForm
              mode="service"
              items={items}
              rows={services.map((s) => ({
                id: s.id,
                name: s.name,
                group: s.category,
                detail: s.unit,
                price: s.price,
                code: s.xeroItemCode,
              }))}
            />
          )}

          <div className="card">
            <h2>Cached products ({items.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th className="num">Default price</th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.code}>
                    <td>
                      <code>{i.code}</code>
                    </td>
                    <td>
                      {i.name}
                      {i.description && i.description !== i.name && (
                        <div className="muted small">{i.description.slice(0, 80)}</div>
                      )}
                    </td>
                    <td className="num">{i.unitPrice != null ? `£${i.unitPrice.toFixed(2)}` : "—"}</td>
                    <td className="muted small">{i.accountCode ?? "default"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
