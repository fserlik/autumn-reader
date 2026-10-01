// A real PDF with two text pages and a graphic-only page, generated without binary fixtures.
export function samplePdf(searchable=true,navigation=false): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 1; page <= 3; page++) {
    const stream = page === 3 || !searchable ? "0.8 g 50 50 490 740 re f" : [
      `BT /F1 18 Tf 45 785 Td (Chapter ${page}) Tj ET`,
      ...Array.from({ length: 62 }, (_, i) => `BT /F1 10 Tf 45 ${754 - i * 11} Td (Line ${String(i + 1).padStart(2, "0")}: This is a sentence from original page ${page} with words to read.) Tj ET`),
    ].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (page - 1) * 2} 0 R ${navigation&&page===2?"/Annots [10 0 R]":""} >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  if(navigation){objects[0]="<< /Type /Catalog /Pages 2 0 R /Outlines 11 0 R >>";objects.push("<< /Type /Annot /Subtype /Link /Rect [45 740 400 770] /Border [0 0 0] /Dest [4 0 R /XYZ 45 754 null] >>","<< /Type /Outlines /First 12 0 R /Last 12 0 R /Count 1 >>","<< /Title (Chapter One) /Parent 11 0 R /Dest [4 0 R /XYZ 45 754 null] >>");}
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
