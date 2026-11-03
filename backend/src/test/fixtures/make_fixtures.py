"""Builds the import-fidelity fixtures used by the backend tests.

    python3 src/test/fixtures/make_fixtures.py          # from backend/

Needs python-pptx, python-docx and Pillow. The PDF fixture is the PPTX
exported by LibreOffice:

    soffice --headless --convert-to pdf --outdir src/test/fixtures \
        src/test/fixtures/fidelity-deck.pptx

The decks are modelled on a typical academic project presentation: a
crowded title slide with a logo, a two-column table of contents, a
text-heavy slide with bold labels, a comparison table and a themed
slide. Every value here is arbitrary test data.
"""
import copy
import io
import os

from lxml import etree
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
SERIF = 'Times New Roman'


def logo_png():
    img = Image.new('RGBA', (240, 240), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, 236, 236), fill=(150, 30, 40, 255))
    d.ellipse((40, 40, 200, 200), fill=(255, 255, 255, 255))
    d.rectangle((90, 70, 150, 170), fill=(40, 90, 160, 255))
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)
    return buf


def texture_png():
    img = Image.new('RGB', (320, 180), (18, 52, 40))
    d = ImageDraw.Draw(img)
    for i in range(0, 320, 16):
        d.line((i, 0, i - 90, 180), fill=(30, 80, 60), width=6)
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)
    return buf


def run(p, text, size=None, bold=None, italic=None, color=None, font=SERIF, underline=None):
    r = p.add_run()
    r.text = text
    f = r.font
    if size:
        f.size = Pt(size)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic
    if underline is not None:
        f.underline = underline
    if color:
        f.color.rgb = RGBColor.from_string(color)
    if font:
        f.name = font
    return r


def textbox(slide, x, y, w, h, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.TOP, wrap=True):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.paragraphs[0].alignment = align
    return tb, tf


def para(tf, first=False, align=None):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align if align is not None else tf.paragraphs[0].alignment
    return p


def set_autonumber(p, scheme='arabicPeriod', start=None):
    pPr = p._p.get_or_add_pPr()
    pPr.set('marL', str(Emu(Inches(0.4))))
    pPr.set('indent', str(-Emu(Inches(0.4))))
    el = etree.SubElement(pPr, qn('a:buAutoNum'))
    el.set('type', scheme)
    if start:
        el.set('startAt', str(start))


def set_bullet(p, char='•', level=0):
    pPr = p._p.get_or_add_pPr()
    pPr.set('lvl', str(level))
    pPr.set('marL', str(Emu(Inches(0.35 + 0.35 * level))))
    pPr.set('indent', str(-Emu(Inches(0.3))))
    bu = etree.SubElement(pPr, qn('a:buChar'))
    bu.set('char', char)


def no_bullet(p):
    pPr = p._p.get_or_add_pPr()
    etree.SubElement(pPr, qn('a:buNone'))


def build_pptx():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    title_only = prs.slide_layouts[5]
    title_content = prs.slide_layouts[1]

    # --- 1. Title slide ---------------------------------------------------
    s = prs.slides.add_slide(blank)
    _, tf = textbox(s, 3.5, 0.05, 6.3, 0.45)
    run(para(tf, True), '|| Jai Sri Gurudev ||', 14, bold=True)
    s.shapes.add_picture(logo_png(), Inches(1.6), Inches(0.55), Inches(1.15), Inches(1.15))
    _, tf = textbox(s, 2.8, 0.7, 8.0, 1.2)
    run(para(tf, True), 'BGS College of Engineering and Technology', 16, bold=True)
    run(para(tf), 'Mahalakshmipuram, West of Chord Road, Bengaluru-560086', 14, bold=False)
    run(para(tf), '(Approved by AICTE, New Delhi and Affiliated to VTU, Belagavi)', 14, italic=True)
    _, tf = textbox(s, 1.5, 1.95, 10.3, 0.95)
    run(para(tf, True), 'Department of Information Science and Engineering', 22, bold=True)
    run(para(tf), 'Academic Year: 2026–27', 20, bold=False)
    _, tf = textbox(s, 1.5, 3.0, 10.3, 0.7)
    run(para(tf, True), 'Major Project Final Presentation', 32, bold=True, color='1F3864')
    _, tf = textbox(s, 1.5, 3.75, 10.3, 1.3)
    run(para(tf, True), 'S.H.I.E.L.D.', 24, bold=True)
    p = para(tf)
    run(p, 'Smart system for Harmful Interaction Evaluation and Live Detection', 20, italic=True)
    _, tf = textbox(s, 1.6, 5.2, 3.2, 1.6)
    run(para(tf, True), 'Guide:', 16, bold=True)
    run(para(tf), 'Ms. Poojitha K,', 16)
    run(para(tf), 'Asst. Professor, Dept. of ISE', 14)
    _, tf = textbox(s, 6.0, 5.2, 6.2, 1.9, align=PP_ALIGN.LEFT)
    run(para(tf, True, PP_ALIGN.LEFT), 'Team Members:', 16, bold=True)
    for name, usn in [('Amruth B', '1MP23IS005'), ('Anush H M', '1MP23IS008'),
                      ('Harshavardhan N', '1MP23IS025'), ('Yashwanth D', '1MP23IS062')]:
        p = para(tf, align=PP_ALIGN.LEFT)
        run(p, name, 14)
        run(p, f'\t({usn})', 14, bold=False)

    # --- 2. Table of contents (two columns, auto numbering) --------------
    s = prs.slides.add_slide(title_only)
    s.shapes.title.text_frame.text = 'Table of Contents'
    s.shapes.title.text_frame.paragraphs[0].runs[0].font.name = SERIF
    s.shapes.title.text_frame.paragraphs[0].runs[0].font.bold = True
    _, tf = textbox(s, 1.2, 1.6, 5.4, 5.2, align=PP_ALIGN.LEFT)
    items = ['Introduction', 'Problem Statement', 'Objectives of the Project', 'Existing System & Their Limitations',
             'Proposed System', 'Literature Survey', 'System Requirements', 'Methodology', 'Technology Stack',
             'Datasets Used']
    for i, item in enumerate(items):
        p = para(tf, i == 0, PP_ALIGN.LEFT)
        set_autonumber(p)
        run(p, item, 20)
    _, tf = textbox(s, 7.0, 1.6, 5.2, 2.4, align=PP_ALIGN.LEFT)
    for i, item in enumerate(['Modules Implemented', 'Future Enhancements', 'Conclusion', 'References']):
        p = para(tf, i == 0, PP_ALIGN.LEFT)
        set_autonumber(p, start=11)
        run(p, item, 20)

    # --- 3. Text-heavy slide with bold labels and nested bullets ---------
    s = prs.slides.add_slide(title_content)
    s.shapes.title.text_frame.text = 'Introduction'
    body = s.placeholders[1].text_frame
    points = [
        ('Rapid Growth:', ' Voice-based communication (gaming, video calls, online meetings) is growing worldwide.'),
        ('Beyond Words:', ' Harmful speech is conveyed through tone, pitch and aggression, not just words.'),
        ('The Blind Spot:', ' Existing platforms moderate only text content.'),
        ('Real Consequences:', ' Aggressive speech causes immediate harm and spreads before intervention.'),
    ]
    for i, (label, rest) in enumerate(points):
        p = para(body, i == 0)
        run(p, label, 20, bold=True, font=None)
        run(p, rest, 20, bold=False, font=None)
    p = para(body)
    p.level = 1
    run(p, 'Live voice conversations go unmonitored.', 16, italic=True, font=None)
    # PowerPoint shrank this text to fit when it was saved.
    bodyPr = body._txBody.find(qn('a:bodyPr'))
    for old in bodyPr.findall(qn('a:normAutofit')):
        bodyPr.remove(old)
    fit = etree.SubElement(bodyPr, qn('a:normAutofit'))
    fit.set('fontScale', '92500')
    fit.set('lnSpcReduction', '10000')

    # --- 4. Comparison table ---------------------------------------------
    s = prs.slides.add_slide(title_only)
    s.shapes.title.text_frame.text = 'Existing System & Their Limitations'
    rows = [
        ('System / Tool', 'Approach', 'Limitation'),
        ('Google Perspective API', 'Text-only toxicity scoring', 'Cannot process live voice; ignores tone'),
        ('Discord AutoMod', 'Keyword filtering on text', 'No audio analysis; reactive only'),
        ('YouTube / Facebook AI', 'Post-content text/video moderation', 'Not real-time; voice calls unmonitored'),
        ('Manual Moderation', 'Human reviewers', 'Unscalable; too slow for live conversations'),
    ]
    gf = s.shapes.add_table(len(rows), 3, Inches(0.8), Inches(1.6), Inches(11.7), Inches(4.4))
    table = gf.table
    table.columns[0].width = Inches(3.2)
    table.columns[1].width = Inches(3.9)
    table.columns[2].width = Inches(4.6)
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            cell = table.cell(r, c)
            cell.text = value
            para_ = cell.text_frame.paragraphs[0]
            para_.runs[0].font.size = Pt(16 if r else 18)
            para_.runs[0].font.bold = r == 0
            if r == 0:
                para_.alignment = PP_ALIGN.CENTER
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor(0x1F, 0x38, 0x64)
                para_.runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    merged = table.cell(4, 1)
    merged.merge(table.cell(4, 2))
    merged.text = 'Human reviewers: unscalable and too slow for live conversations'

    # --- 5. Themed slide: gradient background, shapes, white text --------
    s = prs.slides.add_slide(blank)
    fill = s.background.fill
    fill.gradient()
    fill.gradient_angle = 90
    stops = fill.gradient_stops
    stops[0].color.rgb = RGBColor(0x10, 0x2A, 0x43)
    stops[1].color.rgb = RGBColor(0x2E, 0x5E, 0x4E)
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(6.9), prs.slide_width, Inches(0.6))
    bar.fill.solid()
    bar.fill.fore_color.rgb = RGBColor(0xC8, 0x9B, 0x3C)
    bar.line.fill.background()
    dot = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(11.3), Inches(0.5), Inches(1.4), Inches(1.4))
    dot.fill.solid()
    dot.fill.fore_color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    dot.line.color.rgb = RGBColor(0xC8, 0x9B, 0x3C)
    dot.line.width = Pt(3)
    _, tf = textbox(s, 1.0, 2.2, 9.5, 2.6, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE)
    run(para(tf, True, PP_ALIGN.LEFT), 'Proposed System', 40, bold=True, color='FFFFFF', font='Arial')
    run(para(tf, align=PP_ALIGN.LEFT), 'Real-time analysis of tone, pitch and words in live voice calls.', 20,
        color='E6EEF5', font='Arial')
    badge = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.0), Inches(5.3), Inches(3.0), Inches(0.7))
    badge.fill.solid()
    badge.fill.fore_color.rgb = RGBColor(0xC8, 0x9B, 0x3C)
    badge.line.fill.background()
    badge.text_frame.text = 'Live detection'
    badge.text_frame.paragraphs[0].runs[0].font.size = Pt(18)
    badge.text_frame.paragraphs[0].runs[0].font.bold = True
    badge.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x10, 0x2A, 0x43)

    # --- 6. Picture background and a chart -------------------------------
    s = prs.slides.add_slide(title_only)
    s.shapes.title.text_frame.text = 'Results'
    s.shapes.title.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    bg = s.background.fill
    # python-pptx has no API for picture backgrounds, so write the XML.
    rid = s.part.get_or_add_image_part(texture_png())[1]
    cSld = s._element.find(qn('p:cSld'))
    for old in cSld.findall(qn('p:bg')):
        cSld.remove(old)
    bg_xml = etree.SubElement(cSld, qn('p:bg'))
    cSld.remove(bg_xml)
    cSld.insert(0, bg_xml)
    bgPr = etree.SubElement(bg_xml, qn('p:bgPr'))
    blip_fill = etree.SubElement(bgPr, qn('a:blipFill'))
    blip = etree.SubElement(blip_fill, qn('a:blip'))
    blip.set(qn('r:embed'), rid)
    stretch = etree.SubElement(blip_fill, qn('a:stretch'))
    etree.SubElement(stretch, qn('a:fillRect'))
    etree.SubElement(bgPr, qn('a:effectLst'))
    data = CategoryChartData()
    data.categories = ['Precision', 'Recall', 'F1']
    data.add_series('Model', (0.91, 0.88, 0.89))
    s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(2), Inches(1.8), Inches(9), Inches(5), data)

    out = os.path.join(HERE, 'fidelity-deck.pptx')
    prs.save(out)
    print('wrote', out)


def build_docx():
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.shared import Inches as DInches, Pt as DPt, RGBColor as DRGB

    doc = Document()
    section = doc.sections[0]
    section.page_width = DInches(8.27)
    section.page_height = DInches(11.69)
    section.left_margin = section.right_margin = DInches(1)
    section.header.paragraphs[0].text = 'S.H.I.E.L.D. project report'
    section.footer.paragraphs[0].text = 'BGS College of Engineering and Technology'

    doc.add_heading('Project Report', 0)
    p = doc.add_paragraph()
    r = p.add_run('Abstract. ')
    r.bold = True
    r = p.add_run('This report describes a system that detects harmful speech in ')
    r = p.add_run('live')
    r.italic = True
    p.add_run(' voice conversations.')
    doc.add_heading('Introduction', 1)
    doc.add_paragraph('Voice chat is growing quickly.', style='List Bullet')
    doc.add_paragraph('Moderation tools focus on text.', style='List Bullet')
    p = doc.add_paragraph()
    r = p.add_run('Red, centred and 14pt.')
    r.font.color.rgb = DRGB(0xC0, 0x1F, 0x2F)
    r.font.size = DPt(14)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_picture(logo_png(), width=DInches(1.2))
    doc.add_heading('Comparison', 1)
    t = doc.add_table(rows=3, cols=3)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for r_i, row in enumerate([('Tool', 'Approach', 'Limitation'),
                               ('Perspective API', 'Text scoring', 'No audio'),
                               ('Manual review', 'Humans', 'Slow')]):
        for c_i, value in enumerate(row):
            cell = t.cell(r_i, c_i)
            cell.text = value
            if r_i == 0:
                cell.paragraphs[0].runs[0].bold = True
                shd = OxmlElement('w:shd')
                shd.set(qn('w:val'), 'clear')
                shd.set(qn('w:fill'), 'D9E2F3')
                cell._tc.get_or_add_tcPr().append(shd)
    t.cell(2, 1).merge(t.cell(2, 2))
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.add_heading('Conclusion', 1)
    doc.add_paragraph('Live voice moderation is feasible.')
    out = os.path.join(HERE, 'fidelity-report.docx')
    doc.save(out)
    print('wrote', out)


def build_academic_docx():
    """A college report front matter, the way such reports are usually
    typed: a floating logo beside a centred heading, signature lines and a
    table of contents laid out with tab stops, manual line breaks, and
    runs whose own font only names the complex-script face (so their
    Latin face comes from the style)."""
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
    from docx.oxml import OxmlElement, parse_xml
    from docx.shared import Inches as DInches, Pt as DPt

    doc = Document()
    section = doc.sections[0]
    section.page_width = DInches(8.27)
    section.page_height = DInches(11.69)
    section.left_margin = section.right_margin = DInches(1)
    normal = doc.styles['Normal']
    normal.font.name = SERIF
    normal.font.size = DPt(12)

    def cs_only(run):
        rpr = run._r.get_or_add_rPr()
        fonts = OxmlElement('w:rFonts')
        fonts.set(qn('w:cs'), SERIF)
        rpr.insert(0, fonts)
        return run

    # A logo floating at the left margin, square wrapping, next to the heading.
    pic_par = doc.add_paragraph()
    inline = pic_par.add_run().add_picture(logo_png(), width=DInches(1.1))._inline
    graphic = inline.find(qn('a:graphic'))
    extent = inline.find(qn('wp:extent'))
    anchor = parse_xml(
        '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="2" '
        'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/>'
        '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>'
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>381000</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{extent.get("cx")}" cy="{extent.get("cy")}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>'
        '<wp:docPr id="10" name="Logo"/><wp:cNvGraphicFramePr/></wp:anchor>')
    anchor.append(graphic)
    inline.getparent().replace(inline, anchor)

    h = doc.add_heading('VISVESVARAYA TECHNOLOGICAL UNIVERSITY', 1)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cs_only(p.add_run('Jnana Sangama, Belagavi – 590 018.'))

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    cs_only(p.add_run('This is to certify that '))
    r = cs_only(p.add_run('STUDENT NAME (USN)'))
    r.bold = True
    cs_only(p.add_run(' has successfully completed the Information & Network Security project.'))
    p.add_run().add_break()
    cs_only(p.add_run('Approved for the academic year 2026-27.'))

    # Signature lines: a centre stop and a right stop.
    for left, right, bold in (('Signature of the Guide', 'Signature of the HOD', False),
                              ('Mr. Guide Name', 'Dr. HOD Name', True)):
        p = doc.add_paragraph()
        stops = p.paragraph_format.tab_stops
        stops.add_tab_stop(DInches(6.27), WD_TAB_ALIGNMENT.RIGHT)
        r = cs_only(p.add_run(f'{left}\t{right}'))
        r.bold = bold

    p = doc.add_paragraph()
    cs_only(p.add_run('Student Name')).bold = True
    p.add_run().add_break()
    cs_only(p.add_run('USN')).bold = True

    doc.add_heading('CONTENTS', 1)
    for i, (title, page) in enumerate((('Certificate', ''), ('Acknowledgment', 'i'), ('Abstract', 'ii'))):
        p = doc.add_paragraph()
        p.paragraph_format.tab_stops.add_tab_stop(DInches(6.27), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        cs_only(p.add_run(f'{i + 1}. {title}\t{page}')).bold = True

    out = os.path.join(HERE, 'academic-report.docx')
    doc.save(out)
    print('wrote', out)


if __name__ == '__main__':
    build_pptx()
    build_docx()
    build_academic_docx()
