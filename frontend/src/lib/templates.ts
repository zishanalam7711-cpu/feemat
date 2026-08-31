export function receiptHtml(r: any, extras?: { class_name?: string; batch_name?: string }): string {
  const fmt = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const date = new Date(r.date);
  const styles = `
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 32px; color: #0F172A; }
    .card { max-width: 640px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 20px; padding: 32px; background: #fff; }
    .top { display: flex; justify-content: space-between; align-items: center; }
    .brand { font-size: 30px; font-weight: 900; color: #7C3AED; letter-spacing: 1px; }
    .badge { padding: 6px 12px; border-radius: 8px; background: #10B981; color: #fff; font-weight: 800; font-size: 12px; }
    .institute { font-size: 18px; font-weight: 800; margin-top: 6px; }
    .teacher { color: #475569; font-size: 13px; }
    .line { height: 1px; background: #F1F5F9; margin: 18px 0; }
    .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
    .k { color: #64748B; }
    .v { color: #0F172A; font-weight: 600; }
    .total { display: flex; justify-content: space-between; align-items: center; }
    .total .lbl { color: #64748B; font-size: 14px; }
    .total .val { color: #7C3AED; font-size: 32px; font-weight: 900; }
    .foot { color: #94A3B8; font-size: 11px; text-align: center; margin-top: 14px; }
    .receipt-num { font-size: 16px; font-weight: 800; }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Receipt ${r.receipt_number}</title><style>${styles}</style></head><body>
    <div class="card">
      <div class="top">
        <div class="brand">FEEMAT</div>
        <div class="badge">PAID</div>
      </div>
      <div class="institute">${r.institute || "Independent Teacher"}</div>
      <div class="teacher">Teacher: ${r.teacher_name || ""}</div>
      <div class="line"></div>
      <div class="row"><div class="k">Receipt #</div><div class="v receipt-num">${r.receipt_number}</div></div>
      <div class="row"><div class="k">Date</div><div class="v">${date.toLocaleString()}</div></div>
      <div class="line"></div>
      <div class="row"><div class="k">Student</div><div class="v">${r.student_name || ""}</div></div>
      <div class="row"><div class="k">Admission</div><div class="v">${r.admission_number}</div></div>
      ${extras?.class_name ? `<div class="row"><div class="k">Class</div><div class="v">${extras.class_name}</div></div>` : ""}
      ${extras?.batch_name ? `<div class="row"><div class="k">Batch</div><div class="v">${extras.batch_name}</div></div>` : ""}
      <div class="row"><div class="k">Fee Month</div><div class="v">${r.month}</div></div>
      <div class="row"><div class="k">Payment Method</div><div class="v">${r.method}</div></div>
      <div class="line"></div>
      <div class="total"><div class="lbl">Amount Paid</div><div class="val">${fmt(r.amount)}</div></div>
      <div class="line"></div>
      <div class="foot">Thank you for your payment. This is a system-generated receipt.<br/>Powered by FeeMat</div>
    </div>
  </body></html>`;
}

export function idCardHtml(card: any): string {
  const logo = card.institute_logo_url || "";
  const photo = card.student?.photo_url || "";
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(card.qr_payload || "")}`;
  const initial = (card.student?.name || "?").trim().charAt(0).toUpperCase();
  const styles = `
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 32px; background: #F8FAFC; }
    .card { width: 320px; margin: 0 auto; border-radius: 24px; overflow: hidden; background: #fff; box-shadow: 0 20px 40px rgba(124,58,237,0.15); }
    .head { background: linear-gradient(135deg,#7C3AED,#EC4899); padding: 22px 20px; color:#fff; text-align:center; }
    .head .logo { width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.22); margin: 0 auto 8px auto; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .head .logo img { width:100%; height:100%; object-fit:cover; }
    .brand { font-weight:900; font-size:20px; letter-spacing:1px; }
    .institute { font-size:14px; margin-top:4px; opacity:.9; }
    .body { padding: 18px 20px; text-align:center; }
    .photo { width:110px; height:110px; border-radius:55px; margin: -60px auto 12px auto; background:#EDE9FE; border:4px solid #fff; overflow:hidden; display:flex; align-items:center; justify-content:center; color:#7C3AED; font-weight:900; font-size:44px; }
    .photo img { width:100%; height:100%; object-fit:cover; }
    .name { font-size: 20px; font-weight: 900; color:#0F172A; }
    .adm { display:inline-block; margin-top:4px; padding:4px 10px; border-radius:999px; background:#EDE9FE; color:#7C3AED; font-weight:800; font-size:11px; letter-spacing:0.5px; }
    .meta { color:#475569; font-size:12px; margin-top:8px; }
    .qr { margin: 16px auto 8px auto; padding: 8px; background:#fff; border:1px solid #E2E8F0; border-radius: 12px; width:180px; height:180px; }
    .qr img { width:100%; height:100%; }
    .foot { background:#F1F5F9; padding:10px; text-align:center; color:#64748B; font-size:11px; }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${card.student?.name || "Student"} ID</title><style>${styles}</style></head><body>
    <div class="card">
      <div class="head">
        <div class="logo">${logo ? `<img src="${logo}"/>` : ""}</div>
        <div class="brand">${(card.institute || "FEEMAT").toUpperCase()}</div>
        <div class="institute">${card.institute_address || ""}</div>
      </div>
      <div class="body">
        <div class="photo">${photo ? `<img src="${photo}"/>` : initial}</div>
        <div class="name">${card.student?.name || ""}</div>
        <div class="adm">ADM: ${card.admission_number}</div>
        <div class="meta">${card.class_name || "—"} ${card.batch_name ? "• " + card.batch_name : ""}</div>
        <div class="meta">Teacher: ${card.teacher_name || ""} (${card.teacher_id || ""})</div>
        <div class="qr"><img src="${qrSrc}"/></div>
      </div>
      <div class="foot">This ID is issued by ${card.institute || "the teacher"} via FeeMat.</div>
    </div>
  </body></html>`;
}
