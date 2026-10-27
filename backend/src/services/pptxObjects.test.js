import { describe, expect, it } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { readFile } from 'fs/promises';
import { extractSlidesFromPptx } from './pptxIngestService.js';
import { exportDeckToPptx, exportDeckToPdf } from './deckExportService.js';
import { chartLayout, niceScale, sanitizeChart } from './chartLayout.js';

// Charts, SmartArt and embedded objects: the content that used to come
// through as a grey "not editable" placeholder.

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const SMARTART_FRAME = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="90" name="Diagram 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="5486400" cy="1828800"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/></a:graphicData></a:graphic></p:graphicFrame>`;

const OLE_FRAME = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="91" name="Object 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="6400800" y="3200400"/><a:ext cx="1828800" cy="1371600"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="v"><p:oleObj name="Worksheet" r:id="rIdOle" progId="Excel.Sheet.12"><p:embed/></p:oleObj></mc:Choice><mc:Fallback><p:oleObj name="Worksheet" r:id="rIdOle" progId="Excel.Sheet.12"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdPrev"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="6400800" y="3200400"/><a:ext cx="1828800" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj></mc:Fallback></mc:AlternateContent></a:graphicData></a:graphic></p:graphicFrame>`;

const box = (name, x, fill, text) => `<dsp:sp modelId="{${name}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2000"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="${x + 91440}" y="91440"/><a:ext cx="1645920" cy="731520"/></dsp:txXfrm></dsp:sp>`;

const DRAWING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dsp:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${box('A', 0, '2E7D5B', 'Plan')}${box('B', 3657600, 'C89B3C', 'Build')}</dsp:spTree></dsp:drawing>`;

const DATA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst/><dgm:cxnLst/><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rIdDr" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>`;

async function buildDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const s1 = pptx.addSlide();
  s1.addChart(pptx.ChartType.pie, [{ name: 'Share', labels: ['North', 'South', 'East'], values: [50, 30, 20] }], {
    x: 0.5, y: 0.5, w: 4, h: 3, showLegend: true, legendPos: 'r', chartColors: ['2E7D5B', 'C89B3C', '4F6D9A']
  });
  s1.addChart(pptx.ChartType.bar, [
    { name: '2025', labels: ['Q1', 'Q2', 'Q3'], values: [3, 5, 4] },
    { name: '2026', labels: ['Q1', 'Q2', 'Q3'], values: [4, 6, 7] }
  ], { x: 5, y: 0.5, w: 4.5, h: 3, barDir: 'bar', barGrouping: 'stacked', showTitle: true, title: 'Revenue', showValue: true });
  const s2 = pptx.addSlide();
  s2.addText('Process', { x: 0.5, y: 0.2, w: 4, h: 0.6, fontSize: 28 });

  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
  const slidePath = 'ppt/slides/slide2.xml';
  const xml = await zip.file(slidePath).async('string');
  zip.file(slidePath, xml.replace('</p:spTree>', `${SMARTART_FRAME}${OLE_FRAME}</p:spTree>`));
  const relsPath = 'ppt/slides/_rels/slide2.xml.rels';
  const rels = await zip.file(relsPath).async('string');
  zip.file(relsPath, rels.replace('</Relationships>', [
    '<Relationship Id="rIdDm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>',
    '<Relationship Id="rIdDr" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>',
    '<Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/sheet1.xlsx"/>',
    '<Relationship Id="rIdPrev" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/preview1.png"/>',
    '</Relationships>'
  ].join('')));
  zip.file('ppt/diagrams/data1.xml', DATA);
  zip.file('ppt/diagrams/drawing1.xml', DRAWING);
  zip.file('ppt/media/preview1.png', Buffer.from(PNG_BASE64, 'base64'));
  zip.file('ppt/embeddings/sheet1.xlsx', 'not really a workbook');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('charts, SmartArt and embedded objects', () => {
  it('turns charts into chart blocks with their data, colours and options', async () => {
    const report = {};
    const [s1] = await extractSlidesFromPptx(await buildDeck(), report);
    const charts = s1.blocks.filter((b) => b.type === 'chart');
    expect(charts).toHaveLength(2);
    const [pie, bar] = charts;
    expect(pie.chart).toMatchObject({ kind: 'pie', categories: ['North', 'South', 'East'], legend: 'right' });
    expect(pie.chart.series[0].values).toEqual([50, 30, 20]);
    expect(pie.chart.series[0].pointColors).toEqual(['#2e7d5b', '#c89b3c', '#4f6d9a']);
    expect(pie).toMatchObject({ x: 48, y: 48, width: 384, height: 288 });
    expect(bar.chart).toMatchObject({ kind: 'bar', grouping: 'stacked', title: 'Revenue', dataLabels: true });
    expect(bar.chart.series.map((s) => s.name)).toEqual(['2025', '2026']);
    expect(bar.chart.series[1].values).toEqual([4, 6, 7]);
    expect(report.charts).toBe(2);
    expect(report.placeholders).toBe(0);
  });

  it('redraws SmartArt from its saved layout as editable shapes and text', async () => {
    const slides = await extractSlidesFromPptx(await buildDeck());
    const s2 = slides[1];
    const shapes = s2.blocks.filter((b) => b.type === 'shape' && b.role !== 'placeholder');
    expect(shapes).toHaveLength(2);
    // Drawing coordinates are relative to the frame at (1in, 1in) = (96px, 96px).
    expect(shapes[0]).toMatchObject({ x: 96, y: 96, width: 192, height: 96, background: '#2e7d5b', shape: 'roundRect' });
    expect(shapes[1].x).toBe(96 + 384);
    const plan = s2.blocks.find((b) => b.text === 'Plan');
    // Text sits in its own rectangle (txXfrm), not the shape's.
    expect(plan).toMatchObject({ x: 105.6, y: 105.6, width: 172.8, fill: '#ffffff', textAlign: 'center', verticalAlign: 'middle' });
    expect(s2.blocks.find((b) => b.text === 'Build')).toBeTruthy();
    expect(s2.blocks.some((b) => b.role === 'placeholder')).toBe(false);
  });

  it('shows an embedded object as its preview picture in the object frame', async () => {
    const slides = await extractSlidesFromPptx(await buildDeck());
    const preview = slides[1].blocks.find((b) => b.role === 'object');
    expect(preview).toMatchObject({ type: 'image', x: 672, y: 336, width: 192, height: 144 });
    expect(preview.imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('exports charts as native PowerPoint charts and draws them in PDFs', async () => {
    const slides = await extractSlidesFromPptx(await buildDeck());
    const deck = { title: 'Charts', slides };
    const out = await JSZip.loadAsync(await exportDeckToPptx(deck));
    const chartParts = Object.keys(out.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    expect(chartParts).toHaveLength(2);
    const xml = (await Promise.all(chartParts.map((f) => out.file(f).async('string')))).join('');
    expect(xml).toMatch(/<c:pieChart\b/);
    expect(xml).toContain('<c:barDir val="bar"/>');
    // Re-importing the export gives the same data back.
    const again = await extractSlidesFromPptx(await exportDeckToPptx(deck));
    const pie = again[0].blocks.find((b) => b.type === 'chart' && b.chart.kind === 'pie');
    expect(pie.chart.series[0].values).toEqual([50, 30, 20]);
    const pdf = await exportDeckToPdf(deck);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('chartLayout', () => {
  it('picks round axis bounds that include zero and the data', () => {
    expect(niceScale(0, 7)).toMatchObject({ min: 0, max: 8 });
    expect(niceScale(-3, 9).min).toBeLessThanOrEqual(-3);
  });

  it('starts a narrow band of large values above zero, like Office', () => {
    const items = chartLayout({ kind: 'column', categories: ['a', 'b'], series: [{ values: [0.91, 0.88] }] }, 400, 300);
    const labels = items.filter((i) => i.type === 'text').map((i) => i.text);
    expect(labels).not.toContain('0');
    // Both bars are drawn, and the smaller one is visibly shorter.
    const bars = items.filter((i) => i.type === 'rect' && i.h > 0);
    expect(bars).toHaveLength(2);
    expect(bars[1].h).toBeLessThan(bars[0].h * 0.7);
  });

  it('keeps every primitive inside the chart box', () => {
    for (const kind of ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter']) {
      const items = chartLayout({ kind, title: 'T', categories: ['a', 'b', 'c'], series: [{ name: 'x', values: [1, -2, 3], xValues: [1, 2, 3] }, { name: 'y', values: [2, 2, 2] }] }, 300, 200);
      for (const it of items) {
        const xs = it.type === 'rect' ? [it.x, it.x + it.w] : it.type === 'line' ? [it.x1, it.x2] : it.type === 'circle' ? [it.cx] : it.type === 'text' ? [it.x] : it.type === 'poly' ? it.points.map((p) => p[0]) : [];
        xs.forEach((x) => expect(x, `${kind} ${it.type}`).toBeGreaterThanOrEqual(-1));
        xs.forEach((x) => expect(x, `${kind} ${it.type}`).toBeLessThanOrEqual(301));
      }
    }
  });

  it('cleans untrusted chart data', () => {
    const c = sanitizeChart({ kind: 'nope', series: [{ name: 5, values: [1, 'x', NaN, 4], color: 'red' }], categories: Array(500).fill('a') });
    expect(c.kind).toBe('column');
    expect(c.series[0]).toEqual({ name: '5', values: [1, null, null, 4] });
    expect(c.categories).toHaveLength(200);
  });

  it('is the same file the frontend draws with', async () => {
    const backend = await readFile(new URL('./chartLayout.js', import.meta.url), 'utf8');
    const frontend = await readFile(new URL('../../../frontend/src/data/chartLayout.js', import.meta.url), 'utf8');
    expect(frontend).toBe(backend);
  });
});

describe('charts in Word documents', () => {
  async function docxWithChart() {
    const { parseDocx } = await import('./docxIngestService.js');
    // Borrow a real chart part from a PowerPoint export.
    const pptx = new PptxGenJS();
    pptx.addSlide().addChart(pptx.ChartType.line, [{ name: 'Accuracy', labels: ['v1', 'v2', 'v3'], values: [0.7, 0.8, 0.9] }], { x: 1, y: 1, w: 4, h: 3 });
    const deck = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
    const chartXml = await deck.file(Object.keys(deck.files).find((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).async('string');
    const zip = await JSZip.loadAsync(await readFile(new URL('../test/fixtures/fidelity-report.docx', import.meta.url)));
    zip.file('word/charts/chart1.xml', chartXml);
    const relsPath = 'word/_rels/document.xml.rels';
    const rels = await zip.file(relsPath).async('string');
    zip.file(relsPath, rels.replace('</Relationships>', '<Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>'));
    const doc = await zip.file('word/document.xml').async('string');
    const para = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="4572000" cy="2743200"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    zip.file('word/document.xml', doc.replace(/(<w:body>)/, `$1${para}`));
    return parseDocx(await zip.generateAsync({ type: 'nodebuffer' }));
  }

  it('reads the chart with its data and gives it a slide of its own', async () => {
    const { analyzeDocx, outlineToSlides, sanitizeOutline, tableIdsOf } = await import('./documentAnalysis.js');
    const parsed = await docxWithChart();
    const chart = parsed.blocks.find((b) => b.type === 'chart');
    expect(chart).toMatchObject({ id: 'chart-1', widthPx: 480, heightPx: 288 });
    expect(chart.chart).toMatchObject({ kind: 'line', categories: ['v1', 'v2', 'v3'] });
    expect(chart.chart.series[0].values).toEqual([0.7, 0.8, 0.9]);
    expect(parsed.found.charts).toBeFalsy();
    const { analysis, outline } = analyzeDocx(parsed, 'report.docx');
    expect(analysis.warnings.join(' ')).not.toMatch(/chart/i);
    const item = outline.find((o) => o.tableId === 'chart-1');
    expect(item).toBeTruthy();
    const slides = outlineToSlides(sanitizeOutline(outline, new Set(), tableIdsOf(parsed.blocks)), parsed.images, parsed.blocks);
    const block = slides.flatMap((s) => s.blocks).find((b) => b.type === 'chart');
    expect(block.chart.series[0].values).toEqual([0.7, 0.8, 0.9]);
    // Fitted into the slide, keeping the chart's 5:3 shape.
    expect(block.width / block.height).toBeCloseTo(480 / 288, 1);
  });
});
