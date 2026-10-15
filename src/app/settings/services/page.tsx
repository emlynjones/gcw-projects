import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createService, updateService, deleteService } from "@/app/xero-actions";
import { gbp } from "@/lib/status";
import { importXeroItemAsService } from "@/app/xero-item-actions";
import ItemSync from "../xero-items/ItemSync";

export const dynamic = "force-dynamic";

const UNITS = ["one-off", "month", "year", "hour", "session", "day", "half-day"];

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; importError?: string }>;
}) {
  const { imported, importError } = await searchParams;
  const services = await prisma.service.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const categories = [...new Set(services.map((s) => s.category))];
  // From the local cache, so this page costs no Xero calls.
  const items = await prisma.xeroItem.findMany({ orderBy: { code: "asc" } });
  const representedCodes = new Set(services.map((service) => service.xeroItemCode).filter(Boolean));
  const importable = items.filter(
    (item) =>
      item.isSold &&
      !representedCodes.has(item.code)
  );
  const lastProductSync = items.reduce<Date | null>(
    (latest, item) => (!latest || item.syncedAt > latest ? item.syncedAt : latest),
    null
  );

  return (
    <>
      <div className="page-head">
        <h1>Services</h1>
        <span className="muted small">All prices ex-VAT · reusable for projects and recurring website services</span>
      </div>

      {imported && <div className="success-msg">Imported <strong>{imported}</strong> from Xero.</div>}
      {importError === "exists" && <div className="error-msg">That Xero product is already represented in the service catalogue.</div>}
      {importError === "missing" && <div className="error-msg">That product is no longer available in the cached Xero product list. Re-sync and try again.</div>}

      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>Import a Xero product</h2>
            <p className="muted small">Creates a Managed Services catalogue item using Xero&apos;s name, sales price and product code. It will then be available to add to projects.</p>
            {lastProductSync && <p className="review-warning small">Product list last refreshed {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(lastProductSync)}. Re-sync to include products added or changed in Xero since then.</p>}
          </div>
          <ItemSync total={items.length} />
        </div>
        {items.length === 0 ? (
          <p className="muted">Sync Xero products to see what is available to import.</p>
        ) : importable.length === 0 ? (
          <p className="muted">Every sellable Xero product is already represented in the catalogue.</p>
        ) : (
          <table>
            <thead><tr><th>Product</th><th className="num">Xero price</th><th>Unit</th><th /></tr></thead>
            <tbody>{importable.map((item) => (
              <tr key={item.code}>
                <td><strong>{item.name}</strong><div className="muted small"><code>{item.code}</code>{item.description && item.description !== item.name ? ` · ${item.description}` : ""}</div></td>
                <td className="num">{item.unitPrice == null ? <span className="review-warning">No price</span> : gbp(item.unitPrice)}</td>
                <td colSpan={2}>
                  <form action={importXeroItemAsService} className="inline-form">
                    <input type="hidden" name="code" value={item.code} />
                    <select name="unit" defaultValue="one-off" style={{ width: 130 }} aria-label={`Unit for ${item.name}`}>
                      {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                    <button type="submit" className="btn btn-sm">Import</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Add service</h2>
        <form action={createService} className="inline-form">
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="new-name">Name</label>
            <input id="new-name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="new-price">Price £</label>
            <input id="new-price" name="price" type="number" step="0.01" min="0" required />
          </div>
          <div className="field">
            <label htmlFor="new-unit">Unit</label>
            <select id="new-unit" name="unit">
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-category">Category</label>
            <input id="new-category" name="category" list="categories" required />
            <datalist id="categories">
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </datalist>
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="new-description">Description</label>
            <input id="new-description" name="description" />
          </div>
          <button type="submit" className="btn">
            Add
          </button>
        </form>
      </div>

      {categories.map((cat) => (
        <div className="card" key={cat}>
          <h2>{cat}</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Price (ex-VAT)</th>
                <th>Unit</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {services
                .filter((s) => s.category === cat)
                .map((s) => (
                  <tr key={s.id}>
                    <td>
                      <details>
                        <summary style={{ cursor: "pointer" }}>{s.name}</summary>
                        <form action={updateService.bind(null, s.id)} className="stack mt">
                          <div className="row">
                            <div className="field">
                              <label>Name</label>
                              <input name="name" defaultValue={s.name} required />
                            </div>
                            <div className="field">
                              <label>Price £</label>
                              <input name="price" type="number" step="0.01" min="0" defaultValue={s.price} />
                            </div>
                            <div className="field">
                              <label>Unit</label>
                              <select name="unit" defaultValue={s.unit}>
                                {UNITS.map((u) => (
                                  <option key={u}>{u}</option>
                                ))}
                              </select>
                            </div>
                            <div className="field">
                              <label>Category</label>
                              <input name="category" defaultValue={s.category} />
                            </div>
                          </div>
                          <div className="field">
                            <label>Description</label>
                            <input name="description" defaultValue={s.description ?? ""} />
                          </div>
                          <div className="field">
                            <label>Bills in Xero as</label>
                            {items.length ? (
                              <select name="xeroItemCode" defaultValue={s.xeroItemCode ?? ""}>
                                <option value="">— no product —</option>
                                {items.map((i) => (
                                  <option key={i.code} value={i.code}>
                                    {i.code} · {i.name}
                                    {i.unitPrice ? ` (£${i.unitPrice.toFixed(2)})` : ""}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="muted small">
                                No products cached yet —{" "}
                                <Link href="/settings/xero-items">sync them from Xero</Link> (one
                                call) and they&apos;ll appear here.
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <label className="small">
                              <input
                                type="checkbox"
                                name="active"
                                defaultChecked={s.active}
                                style={{ width: "auto", marginRight: 6 }}
                              />
                              Active
                            </label>
                            <button type="submit" className="btn btn-sm">
                              Save
                            </button>
                          </div>
                        </form>
                      </details>
                      {s.description && <div className="muted small">{s.description}</div>}
                    </td>
                    <td className="num">{gbp(s.price)}</td>
                    <td className="muted small">{s.unit}</td>
                    <td>{s.active ? "✓" : <span className="muted">—</span>}</td>
                    <td>
                      <form action={deleteService.bind(null, s.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm" style={{ color: "var(--muted)" }}>
                          ✕
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
