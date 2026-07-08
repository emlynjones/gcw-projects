import { prisma } from "@/lib/prisma";
import { createService, updateService, deleteService } from "@/app/xero-actions";
import { gbp } from "@/lib/status";

export const dynamic = "force-dynamic";

const UNITS = ["one-off", "month", "year", "hour", "session", "day", "half-day"];

export default async function ServicesPage() {
  const services = await prisma.service.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const categories = [...new Set(services.map((s) => s.category))];

  return (
    <>
      <div className="page-head">
        <h1>Services</h1>
        <span className="muted small">All prices ex-VAT · seeded from the GCW price list</span>
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
