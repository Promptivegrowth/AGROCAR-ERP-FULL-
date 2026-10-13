import json, sys, os, re, zipfile, datetime
from collections import Counter, defaultdict
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether)

DATOS, CARPETA, SALIDA = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(DATOS, encoding='utf-8'))
comps, bit, acept, verif = d['comps'], d['bit'], d['todosAcept'], d['verif']

LIMA = datetime.timezone(datetime.timedelta(hours=-5))
def lima(iso):
    return datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(LIMA)
def dmy(s):  # YYYY-MM-DD -> DD/MM/YYYY
    a, m, dd = s[:10].split('-'); return f'{dd}/{m}/{a}'
def soles(v): return f'{float(v):,.2f}'
def cod(c): return re.sub(r'^.*\.', '', c or '')

# ── Datos ──────────────────────────────────────────────────────────────────
intentos = defaultdict(list)
for b in bit: intentos[b['comprobante_id']].append(b)
for v in intentos.values(): v.sort(key=lambda x: x['intento'])

filas = []
for c in comps:
    its = intentos.get(c['id'], [])
    ok = [b for b in its if b['aceptado']]
    no = [b for b in its if not b['aceptado']]
    cli = c.get('clientes') or {}
    filas.append({
        'doc': f"{c['serie']}-{c['numero']}", 'tipo': 'Factura' if c['tipo'] == 'factura' else 'Boleta',
        'fe': dmy(c['fecha_emision']), 'cliente': (cli.get('razon_social') or c.get('cliente_externo_nombre') or 'CLIENTES VARIOS'),
        'dcli': cli.get('ruc') or cli.get('dni') or '', 'total': float(c['total']),
        'previo': (f"{lima(no[0]['enviado_at']):%d/%m %H:%M} · {cod(no[0]['codigo']) or 'sin resp.'}" if no else '—'),
        'acept': (f"{lima(ok[0]['enviado_at']):%d/%m/%Y %H:%M}" if ok else '—'),
        'cdr': c.get('sunat_codigo') or '',
    })
filas.sort(key=lambda f: (f['tipo'] != 'Factura', f['doc']))
n_fact = sum(1 for f in filas if f['tipo'] == 'Factura'); n_bol = len(filas) - n_fact
tot_fact = sum(f['total'] for f in filas if f['tipo'] == 'Factura'); tot_bol = sum(f['total'] for f in filas if f['tipo'] == 'Boleta')
por_emision = Counter(f['fe'] for f in filas)

# Aceptados por día y si figuran hoy
primera = {}
for a in acept:
    t = lima(a['enviado_at'])
    if a['comprobante_id'] not in primera or t < primera[a['comprobante_id']]: primera[a['comprobante_id']] = t
dia = defaultdict(lambda: [0, 0])
for cid, t in primera.items():
    k = t.strftime('%Y-%m-%d'); dia[k][0] += 1
    if verif.get(cid) == 'aceptado': dia[k][1] += 1

# CDR de ejemplo y de control
def leer_cdr(ruta):
    z = zipfile.ZipFile(ruta); x = z.read([n for n in z.namelist() if n.endswith('.xml')][0]).decode('utf-8')
    g = lambda tag: (re.search(rf'<cbc:{tag}>(.*?)</cbc:{tag}>', x) or [None, ''])[1]
    emisor = re.search(r'<cac:SenderParty>[\s\S]*?<cbc:ID>(.*?)</cbc:ID>', x).group(1)
    return {'emisor': emisor, 'firma': 'SignSUNAT' in x and 'SignatureValue' in x, 'codigo': g('ResponseCode'),
            'desc': g('Description'), 'fecha': f"{dmy(g('IssueDate'))} {g('IssueTime')[:8]}", 'ref': g('ReferenceID')}
cdr_af = leer_cdr(os.path.join(CARPETA, 'CDR_constancias_SUNAT', 'R-20519883296-01-F002-00000078.zip'))
cdr_ct = leer_cdr(os.path.join(CARPETA, 'CONTROL_comprobante_que_si_figura', 'R-20519883296-01-F002-00000064.zip'))

validez = []
for l in open(os.path.join(CARPETA, 'CONSULTA_DE_VALIDEZ_SUNAT.txt'), encoding='utf-8'):
    m = re.match(r'(\w\d{3}-\d+) \((\d{4}-\d{2}-\d{2}), S/ ([\d.]+)\): .*?· 0000 · (.*)$', l.strip())
    if m: validez.append((m.group(1), dmy(m.group(2)), m.group(3), m.group(4).replace('  ', ' ').strip()))

# ── Estilo ─────────────────────────────────────────────────────────────────
AZUL = colors.HexColor('#0B3A6E'); GRIS = colors.HexColor('#5B6573'); LINEA = colors.HexColor('#D5DBE3')
FONDO = colors.HexColor('#F3F6FA'); ROJO = colors.HexColor('#B42318'); VERDE = colors.HexColor('#067647')
ROJO_F = colors.HexColor('#FEF3F2'); VERDE_F = colors.HexColor('#ECFDF3')
st = lambda name, **kw: ParagraphStyle(name, fontName=kw.pop('font', 'Helvetica'), **kw)
T = st('t', font='Helvetica-Bold', fontSize=15, leading=19, textColor=AZUL, spaceAfter=2)
SUB = st('sub', fontSize=9, leading=12, textColor=GRIS)
H = st('h', font='Helvetica-Bold', fontSize=11, leading=14, textColor=AZUL, spaceBefore=9, spaceAfter=4)
P = st('p', fontSize=9, leading=12.5)
PB = st('pb', font='Helvetica-Bold', fontSize=9, leading=12.5)
LI = st('li', fontSize=9, leading=12.5, leftIndent=10, bulletIndent=0)
CELL = st('c', fontSize=8, leading=10)
CELLB = st('cb', font='Helvetica-Bold', fontSize=8, leading=10)
MINI = st('m', fontSize=6.6, leading=8)
NOTA = st('n', fontSize=7.5, leading=10, textColor=GRIS)

def tabla(data, widths, head=True, zebra=True, extra=None, fs=8):
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    s = [('FONT', (0, 0), (-1, -1), 'Helvetica', fs), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
         ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINEA), ('TOPPADDING', (0, 0), (-1, -1), 3),
         ('BOTTOMPADDING', (0, 0), (-1, -1), 3), ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4)]
    if head:
        s += [('BACKGROUND', (0, 0), (-1, 0), AZUL), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
              ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', fs)]
    if zebra:
        for i in range(1 if head else 0, len(data)):
            if i % 2 == 0: s.append(('BACKGROUND', (0, i), (-1, i), FONDO))
    t.setStyle(TableStyle(s + (extra or [])))
    return t

def caja(contenido, fondo=FONDO, borde=LINEA):
    t = Table([[contenido]], colWidths=[174 * mm])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), fondo), ('BOX', (0, 0), (-1, -1), 0.6, borde),
                           ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                           ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    return t

def pie(canv, doc):
    canv.saveState()
    canv.setFont('Helvetica', 7.5); canv.setFillColor(GRIS)
    canv.drawString(18 * mm, 10 * mm, 'AGROCAR S.R.L. · RUC 20519883296 · Comprobantes aceptados por SUNAT el 10 y 11/10/2026 que no figuran en sus registros')
    canv.drawRightString(192 * mm, 10 * mm, f'Página {doc.page}')
    canv.setStrokeColor(LINEA); canv.line(18 * mm, 13 * mm, 192 * mm, 13 * mm)
    canv.restoreState()

doc = BaseDocTemplate(SALIDA, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=15 * mm, bottomMargin=18 * mm,
                      title='AGROCAR - Comprobantes aceptados por SUNAT que no figuran en sus registros',
                      author='AGROCAR S.R.L.', subject='Solicitud de regularización ante SUNAT')
doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(18 * mm, 18 * mm, 174 * mm, 264 * mm, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=pie)])
s = []

# ── Página 1: qué pasa y qué se pide ───────────────────────────────────────
s.append(Paragraph('Comprobantes aceptados por SUNAT que no figuran en sus registros', T))
s.append(Paragraph('Solicitud de regularización · Sistema de Emisión Electrónica – Del Contribuyente', SUB))
s.append(Spacer(1, 6))
s.append(tabla([
    ['Contribuyente', 'AGROCAR S.R.L.', 'RUC', '20519883296'],
    ['Domicilio fiscal', 'Cal. Emilio Forero Nro 553A – Tacna', 'Fecha', '13/10/2026'],
    ['Comprobantes', f'{len(filas)} ({n_fact} facturas · {n_bol} boletas)', 'Importe total', f'S/ {soles(tot_fact + tot_bol)}'],
], [30 * mm, 74 * mm, 26 * mm, 44 * mm], head=False, zebra=False,
    extra=[('FONT', (0, 0), (0, -1), 'Helvetica-Bold', 8), ('FONT', (2, 0), (2, -1), 'Helvetica-Bold', 8),
           ('TEXTCOLOR', (0, 0), (0, -1), GRIS), ('TEXTCOLOR', (2, 0), (2, -1), GRIS), ('BOX', (0, 0), (-1, -1), 0.6, LINEA)]))

s.append(Paragraph('1. Hecho', H))
s.append(caja([
    Paragraph(f'Los <b>{len(filas)} comprobantes</b> listados en el Anexo 1 fueron enviados a SUNAT por su servicio web '
              f'(<i>billService</i>) y <b>aceptados por SUNAT el sábado 10/10/2026 y el domingo 11/10/2026</b>, '
              'dentro del plazo de la RS N.° 000003-2023/SUNAT. Cada uno tiene su <b>Constancia de Recepción (CDR) '
              'con código 0 – "ha sido aceptado"</b>, firmada por SUNAT (RUC 20131312955).', P),
    Spacer(1, 4),
    Paragraph('Sin embargo, <b>no figuran en los registros de SUNAT</b>: la consulta de validez responde '
              '<i>"no existe en los registros de SUNAT"</i> (facturas) y <i>"no ha sido informada a SUNAT"</i> (boletas).', P),
]))

s.append(Paragraph('2. Por qué es una falla del sistema de SUNAT', H))
for b in [
    f'<b>Solo afecta a lo aceptado el 10 y 11/10.</b> Los comprobantes aceptados hasta el 09/10 y desde el 12/10 '
    'figuran correctamente, enviados con el mismo sistema, certificado digital y usuario SOL (Evidencia A).',
    'En esos días el servicio de SUNAT respondió primero <b>0140 – "Existe un documento igual en proceso"</b> y, el '
    '12/10, <b>HTTP 502</b> (error de su servidor); luego aceptó los comprobantes con CDR código 0 (Evidencia D).',
    'Las constancias de los comprobantes afectados son <b>idénticas</b> a las de comprobantes que sí figuran '
    '(Evidencia B). La consulta de validez lo confirma caso por caso (Evidencia C).',
    'El 12/10/2026, la central de consultas de SUNAT indicó por teléfono al contribuyente que <b>existe un problema '
    'en su sistema</b>.',
]:
    s.append(Paragraph(b, LI, bulletText='•'))

s.append(Paragraph('3. Solicitud', H))
s.append(caja([
    Paragraph('1) <b>Registrar o reprocesar</b> los ' + str(len(filas)) + ' comprobantes del Anexo 1 conforme a las '
              'constancias (CDR) que SUNAT emitió el 10 y 11/10/2026.', P),
    Spacer(1, 3),
    Paragraph('2) <b>Considerarlos enviados dentro del plazo</b>, por haber sido aceptados por SUNAT en esas fechas, '
              'sin observación ni sanción por envío extemporáneo.', P),
    Spacer(1, 3),
    Paragraph('3) Que figuren en la consulta de comprobantes, para que nuestros clientes puedan validarlos.', P),
], fondo=colors.HexColor('#EEF4FB'), borde=colors.HexColor('#B9CCE4')))

s.append(Paragraph('Anexos digitales (carpeta adjunta)', H))
s.append(tabla([
    ['Carpeta / archivo', 'Contenido'],
    ['XML_enviados\\', f'{len(filas)} XML firmados, tal como se enviaron a SUNAT'],
    ['CDR_constancias_SUNAT\\', f'{len(filas)} constancias (ZIP) devueltas por SUNAT, código 0'],
    ['RESUMEN_comprobantes.csv', 'Cada comprobante: cliente, total, cada intento de envío y la consulta actual'],
    ['CONSULTA_DE_VALIDEZ_SUNAT.txt', 'Respuesta de la consulta de validez (comprobantes afectados y de control)'],
    ['CONTROL_comprobante_que_si_figura\\', 'Factura F002-00000064: mismo sistema, sí figura'],
], [62 * mm, 112 * mm], fs=7.5))
s.append(Spacer(1, 22))
s.append(Table([['', '_______________________________________'], ['', 'Representante legal · AGROCAR S.R.L.']],
               colWidths=[90 * mm, 84 * mm],
               style=TableStyle([('FONT', (0, 0), (-1, -1), 'Helvetica', 8), ('ALIGN', (1, 0), (1, -1), 'CENTER'),
                                 ('TEXTCOLOR', (1, 1), (1, 1), GRIS)])))
s.append(PageBreak())

# ── Página 2: evidencias ───────────────────────────────────────────────────
s.append(Paragraph('Evidencias', T)); s.append(Spacer(1, 2))

s.append(Paragraph('A. Comprobantes aceptados por SUNAT, por día de aceptación, y si figuran hoy en sus registros', H))
filas_a = [['Día de aceptación (CDR)', 'Aceptados', 'Figuran en SUNAT', 'No figuran']]
extra_a = []
for k in sorted(dia):
    acc, fig = dia[k]; no = acc - fig
    filas_a.append([dmy(k), str(acc), str(fig), str(no)])
    if no:
        r = len(filas_a) - 1
        extra_a += [('BACKGROUND', (0, r), (-1, r), ROJO_F), ('TEXTCOLOR', (3, r), (3, r), ROJO), ('FONT', (0, r), (-1, r), 'Helvetica-Bold', 8)]
s.append(tabla(filas_a, [52 * mm, 34 * mm, 44 * mm, 44 * mm], zebra=False,
               extra=[('ALIGN', (1, 0), (-1, -1), 'CENTER')] + extra_a))
s.append(Paragraph('Fuente: registro de envíos del sistema y consulta a SUNAT del 13/10/2026. Solo los aceptados el 10 y 11/10 no figuran.', NOTA))

s.append(Paragraph('B. Constancia de Recepción (CDR): comprobante afectado vs. comprobante de control', H))
s.append(tabla([
    ['Dato de la constancia', 'F002-00000078 (afectado)', 'F002-00000064 (control)'],
    ['Emitida por', f"SUNAT · RUC {cdr_af['emisor']}", f"SUNAT · RUC {cdr_ct['emisor']}"],
    ['Firma digital de SUNAT', 'Sí' if cdr_af['firma'] else 'No', 'Sí' if cdr_ct['firma'] else 'No'],
    ['Código de respuesta', cdr_af['codigo'], cdr_ct['codigo']],
    ['Descripción', cdr_af['desc'], cdr_ct['desc']],
    ['Fecha y hora de la constancia', cdr_af['fecha'], cdr_ct['fecha']],
    ['Consulta de validez hoy', 'No existe en los registros', 'Comprobante válido'],
], [50 * mm, 62 * mm, 62 * mm], zebra=False,
    extra=[('FONT', (0, 1), (0, -1), 'Helvetica-Bold', 8), ('TEXTCOLOR', (1, -1), (1, -1), ROJO), ('TEXTCOLOR', (2, -1), (2, -1), VERDE),
           ('FONT', (1, -1), (-1, -1), 'Helvetica-Bold', 8)]))
s.append(Paragraph('Ambas constancias tienen la misma estructura; solo cambian número, fecha y cliente. Las 121 constancias están en la carpeta adjunta.', NOTA))

s.append(Paragraph('C. Consulta de validez de SUNAT (13/10/2026)', H))
filas_c = [['Comprobante', 'Emisión', 'Importe S/', 'Aceptado', 'Respuesta de SUNAT']]
extra_c = []
acept_doc = {f['doc'].split('-')[0] + '-' + str(int(f['doc'].split('-')[1])): f['acept'] for f in filas}
for dcp, fe, imp, msg in validez:
    valido = 'válido' in msg
    filas_c.append([dcp, fe, soles(imp), acept_doc.get(dcp, '09/10/2026' if dcp == 'F002-64' else '12/10/2026'),
                    Paragraph((lambda x: x[:1].upper() + x[1:])(re.sub(r'^La (Factura|Boleta de Venta) Electrónica \S+\s*', '', msg)), CELL)])
    r = len(filas_c) - 1
    extra_c.append(('TEXTCOLOR', (4, r), (4, r), VERDE if valido else ROJO))
s.append(tabla(filas_c, [26 * mm, 22 * mm, 20 * mm, 30 * mm, 76 * mm], zebra=True, extra=[('ALIGN', (2, 0), (2, -1), 'RIGHT')] + extra_c))

s.append(Paragraph('D. Respuestas del servicio de envío de SUNAT', H))
s.append(tabla([
    ['Fecha y hora', 'Comprobantes', 'Respuesta de SUNAT'],
    ['10/10/2026 06:00', '68 (emitidos 08/10)', '0140 – Existe un Documento igual en Proceso'],
    ['10/10/2026 13:00', '68 (emitidos 08/10)', 'CDR código 0 – aceptado  →  hoy no figuran'],
    ['11/10/2026 06:00', '53 (emitidos 09/10)', '0140 – Existe un Documento igual en Proceso'],
    ['11/10/2026 13:00', '53 (emitidos 09/10)', 'CDR código 0 – aceptado  →  hoy no figuran'],
    ['12/10/2026 06:00', '80 (emitidos 10/10)', 'HTTP 502 – error del servidor de SUNAT'],
    ['12/10/2026 09:19–10:30', '80 (emitidos 10/10)', 'CDR código 0 – aceptado  →  sí figuran'],
], [38 * mm, 40 * mm, 96 * mm], extra=[('TEXTCOLOR', (2, 2), (2, 2), ROJO), ('TEXTCOLOR', (2, 4), (2, 4), ROJO), ('TEXTCOLOR', (2, 6), (2, 6), VERDE)]))
s.append(Paragraph('Plazo de envío (RS N.° 000003-2023/SUNAT): emitidos el 08/10 hasta el 11/10; emitidos el 09/10 hasta el 12/10. Todos fueron aceptados dentro del plazo.', NOTA))
s.append(PageBreak())

# ── Anexo 1: lista completa ────────────────────────────────────────────────
s.append(Paragraph(f'Anexo 1. Comprobantes afectados ({len(filas)})', T))
s.append(Paragraph(f'{n_fact} facturas por S/ {soles(tot_fact)} · {n_bol} boletas por S/ {soles(tot_bol)} · '
                   f'emitidos el 08/10/2026: {por_emision.get("08/10/2026", 0)} · el 09/10/2026: {por_emision.get("09/10/2026", 0)}. '
                   'Todos con CDR código 0 y "no existe / no informada" en la consulta del 13/10/2026.', SUB))
s.append(Spacer(1, 5))
cab = ['N°', 'Comprobante', 'Tipo', 'Emisión', 'Cliente', 'RUC / DNI', 'Total S/', 'Intento previo', 'CDR código 0']
data = [cab]
for i, f in enumerate(filas, 1):
    data.append([str(i), f['doc'], f['tipo'], f['fe'][:5], f['cliente'][:36], f['dcli'], soles(f['total']), f['previo'], f['acept'][:5] + f['acept'][10:]])
data.append(['', '', '', '', 'TOTAL', '', soles(tot_fact + tot_bol), '', ''])
t = tabla(data, [7 * mm, 21 * mm, 11 * mm, 10 * mm, 56 * mm, 17 * mm, 14 * mm, 20 * mm, 18 * mm], fs=6.6,
          extra=[('ALIGN', (6, 0), (6, -1), 'RIGHT'), ('ALIGN', (0, 0), (0, -1), 'CENTER'),
                 ('TOPPADDING', (0, 1), (-1, -1), 1.6), ('BOTTOMPADDING', (0, 1), (-1, -1), 1.6),
                 ('FONT', (0, -1), (-1, -1), 'Helvetica-Bold', 6.6), ('LINEABOVE', (0, -1), (-1, -1), 0.8, AZUL),
                 ('LINEBEFORE', (7, 0), (7, -1), 0.4, LINEA), ('LINEBEFORE', (8, 0), (8, -1), 0.4, LINEA)])
s.append(t)
s.append(Spacer(1, 4))
s.append(Paragraph('Intento previo: primer envío del comprobante y la respuesta de SUNAT (0140 = documento igual en proceso). '
                   'CDR código 0: fecha y hora en que SUNAT emitió la constancia de aceptación (año 2026).', NOTA))

doc.build(s)
print('PDF:', SALIDA, '·', len(filas), 'comprobantes')
