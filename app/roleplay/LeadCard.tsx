"use client";

import { useState } from "react";
import { leadMoney, leadTotal, type Lead } from "@/lib/roleplay";

/**
 * What the rep has on screen during a real call: the lead, then the loan
 * result and the credit report once they run them. Hidden until pressed, so
 * the rep has to get there in the call first -- the same as the dialer.
 */
export default function LeadCard({ name, lead, es }: { name: string; lead: Lead; es: boolean }) {
  const [loan, setLoan] = useState(false);
  const [credit, setCredit] = useState(false);

  return (
    <div className="card rp-lead">
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>{es ? "Prospecto" : "Lead"}</div>
        <dl>
          <dt>{es ? "Nombre" : "Name"}</dt>
          <dd>{name}</dd>
          {lead.age ? (
            <>
              <dt>{es ? "Edad" : "Age"}</dt>
              <dd>{lead.age}</dd>
            </>
          ) : null}
          {lead.state ? (
            <>
              <dt>{es ? "Estado" : "State"}</dt>
              <dd>{lead.state}</dd>
            </>
          ) : null}
          {lead.source ? (
            <>
              <dt>{es ? "Origen" : "Source"}</dt>
              <dd>{lead.source}</dd>
            </>
          ) : null}
          {lead.requested ? (
            <>
              <dt>{es ? "Solicitó" : "Requested"}</dt>
              <dd>
                {leadMoney(lead.requested)}
                {lead.purpose ? ` -- ${lead.purpose}` : ""}
              </dd>
            </>
          ) : null}
          {lead.notes ? (
            <>
              <dt>{es ? "Notas" : "Notes"}</dt>
              <dd>{lead.notes}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {lead.loan &&
        (loan ? (
          <div className={`rp-reveal ${lead.loan.approved ? "approved" : "declined"}`}>
            <div className="label">SuperMoney</div>
            {lead.loan.text}
          </div>
        ) : (
          <button onClick={() => setLoan(true)}>{es ? "Buscar préstamo (SuperMoney)" : "Run loan offer (SuperMoney)"}</button>
        ))}

      {lead.accounts?.length ? (
        credit ? (
          <div className="rp-reveal" style={{ borderStyle: "solid" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="label" style={{ margin: 0 }}>{es ? "Reporte de crédito" : "Credit report"}</div>
              {lead.credit_score ? <span className="pill">{lead.credit_score}</span> : null}
            </div>
            <table className="rp-accounts">
              <thead>
                <tr>
                  <th>{es ? "Acreedor" : "Creditor"}</th>
                  <th>{es ? "Estado" : "Status"}</th>
                  <th className="num">{es ? "Saldo" : "Balance"}</th>
                </tr>
              </thead>
              <tbody>
                {lead.accounts.map((a, i) => (
                  <tr key={i}>
                    <td>
                      {a.creditor}
                      <div className="hint" style={{ margin: 0 }}>{a.type}</div>
                    </td>
                    <td>{a.status}</td>
                    <td className="num">{leadMoney(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="num">{leadMoney(leadTotal(lead))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <button onClick={() => setCredit(true)}>{es ? "Revisar crédito" : "Pull credit report"}</button>
        )
      ) : null}
    </div>
  );
}
