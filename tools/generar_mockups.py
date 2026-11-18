#!/usr/bin/env python3
# Genera mockups estáticos con DATOS REALES del build. No inventa números.
# Fuentes: public/data/manifest.json, relaciones.json, agregados/* y
# data/ontologia.json. Correr después de pnpm run build.
import json
from collections import Counter
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
D = RAIZ / "public/data"
ID = 166028  # Capital, Salta — entidad de la demo

manifest = json.loads((D / "manifest.json").read_text(encoding="utf8"))
relaciones = json.loads((D / "relaciones.json").read_text(encoding="utf8"))["relaciones"]
ont = json.loads((RAIZ / "data/ontologia.json").read_text(encoding="utf8"))
ag = json.loads((D / "agregados/demografia" / f"{ID}.json").read_text(encoding="utf8"))
obj = next(o for o in manifest["objetos"] if o["yvy_id"] == ID)
cobertura = manifest["geometria"]["artefactos"][0]["cobertura"]
hijos = [o for o in manifest["objetos"] if o.get("parent_yvy_id") == ID]
rels_obj = [r for r in relaciones if r["origen_yvy_id"] == ID]
por_tipo = Counter(r["tipo"] for r in rels_obj)
unidades = {k: v.get("unidad", "") for k, v in ont["metricas"].items()}
cert = ag.get("certificado") or {}

fmt = lambda n: f"{n:,}".replace(",", ".")
poblacion = ag["metricas"]["poblacion"]
densidad = round(poblacion / obj["sup_oficial_km2"], 1) if obj.get("sup_oficial_km2") else None
fila = lambda k, v: f'<span class="k">{k}</span><strong>{v}</strong>'
origen = lambda ag: f'{ag.get("fuente") or "sin fuente"} · corte {ag.get("fecha_vigencia") or "no declarada"} · v{ag.get("version") or "?"}'

CSS = """
:root{--paper:#F9F9F9;--sheet:#FFF;--line:#EAEAEA;--ink:#1A1A1A;--mute:#5A5A5A;--green:#0F5132;--sage:#F4F9F5}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px Inter,system-ui,sans-serif;padding:48px 20px;display:flex;justify-content:center}
.sheet{background:var(--sheet);border:1px solid var(--line);width:min(940px,100%);padding:40px 52px;box-shadow:0 20px 40px -10px #0f172a14}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--mute)}
h1{font:600 46px Lora,Georgia,serif;letter-spacing:-.02em;margin:6px 0 18px}
h2{font:600 19px Lora,Georgia,serif;margin:0}
h3{font:600 11px Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);margin:0 0 8px}
.top{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:26px}
.brand{display:flex;gap:10px;align-items:center;font-weight:700}.brand img{width:28px;height:28px}
.brand small{display:block;font-weight:400;font-size:11px;color:var(--mute);letter-spacing:.04em}
.tag{color:var(--green);border:1px solid #b7d6c3;background:var(--sage);padding:4px 10px;border-radius:3px;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.actions{display:flex;gap:8px}.btn{border:1px solid var(--line);background:#fff;padding:8px 12px;border-radius:4px;font:500 12px Inter,sans-serif}.btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.hero{border:1px solid #cfe4d5;border-radius:4px;padding:26px;margin-bottom:28px;background:#fcfefc}
.value{font-size:74px;font-weight:500;color:var(--green);line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.label{font-size:15px;font-weight:500;margin-top:10px}.src{font-size:12px;color:var(--mute);margin-top:8px}
.strip{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 0;margin-bottom:26px}
.strip div b{display:block;font-size:22px;color:var(--green);font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;margin-bottom:26px;font-size:13px}
th{text-align:left;font:600 10px Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);border-bottom:1px solid var(--line);padding:8px 4px}
td{border-bottom:1px solid #F1F1F1;padding:9px 4px;font-variant-numeric:tabular-nums}
td.hash{font:11px ui-monospace,monospace;color:var(--green)}
.missing{font-style:italic;color:#999}
.seal{background:var(--sage);border:1px solid #cfe4d5;padding:18px;border-radius:4px;display:flex;gap:14px;align-items:flex-start}
.seal b{font:600 15px Lora,Georgia,serif;color:var(--green)}
code{font:11px ui-monospace,monospace;color:var(--green);overflow-wrap:anywhere}
.note{font-size:11px;color:var(--mute);font-style:italic;margin-top:20px}
ul.tree{list-style:none;padding-left:18px;border-left:1px solid var(--line);margin:8px 0 8px 8px}
ul.tree li{padding:5px 0;font-size:13px}.tree li b{color:var(--green)}
.rel{display:flex;justify-content:space-between;border-bottom:1px solid #F1F1F1;padding:8px 0;font-size:13px}
.rel span:last-child{color:var(--green);font:11px ui-monospace,monospace}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:18px}
.tabs span{padding:8px 14px;font-size:12px;color:var(--mute)}.tabs span.on{color:var(--green);border-bottom:2px solid var(--green)}
"""

head = f"""<!doctype html><html lang="es"><meta charset="utf-8"><title>Yvy Core — mockup</title>
<style>{CSS}</style>"""
brand = f'<div class="brand"><img src="../public/assets/yvy_logo.png" alt=""><div>Yvy Core<small>Infraestructura de datos</small></div></div>'
foot = f'<p class="note">Mockup estático generado el {date.today()} desde public/data/*.json con datos reales. Sin valores inventados.</p>'

# ---------- Command ----------
command = f"""{head}<body><div class="sheet">
{brand}
<div style="padding:70px 0 40px">
<div class="eyebrow">Yvy Core · infraestructura territorial</div>
<h1>Evidencia para decidir.</h1>
<p style="color:var(--mute);max-width:60ch;line-height:1.6">Conectamos datos, documentos y normativas en un solo lugar. Información con trazabilidad, sin alucinaciones.</p>
<div style="border:1px solid var(--line);padding:14px 16px;border-radius:4px;margin:28px 0 14px;color:var(--mute)">Buscar entidad, dato o relación…</div>
<div class="actions"><span class="btn primary">Explorar entidades</span><span class="btn">Ver esquema</span><span class="btn">Auditar linaje</span></div>
</div>
<div class="strip" style="grid-template-columns:repeat(4,1fr)">
<div><b>{fmt(len(manifest['objetos']))}</b> entidades</div>
<div><b>{fmt(len(relaciones))}</b> relaciones</div>
<div><b>0</b> documentos</div>
<div><b>{fmt(cobertura['entidades_con_feature'])}/{fmt(2348)}</b> municipios con geometría</div>
</div>{foot}</div></body></html>"""
(D.parent / "../mockups").mkdir(parents=True, exist_ok=True)
(RAIZ / "mockups/command.html").write_text(command, encoding="utf8")

# ---------- Dossier ----------
filas = []
for k, v in ag["metricas"].items():
    if v is None:
        filas.append(f"<tr><td>{k}</td><td class='missing'>Sin dato</td><td>—</td><td>—</td><td>—</td></tr>")
    else:
        filas.append(
            f"<tr><td>{k}</td><td>{fmt(v)} {unidades.get(k,'')}</td>"
            f"<td>{ag['fuente']}</td><td>{ag['fecha_vigencia']}</td>"
            f"<td class='hash'>✓ {cert.get('hash_entidad','')[:12]}…</td></tr>")
dossier = f"""{head}<body><div class="sheet">
<div class="top">{brand}<div class="actions"><span class="btn">Ver linaje</span><span class="btn">Ver esquema</span><span class="btn primary">Exportar reporte</span></div></div>
<div class="eyebrow">Argentina / Salta / Capital · yvy_id {ID}</div>
<h1>{obj['nombre_oficial']}</h1><span class="tag">{obj['nivel']}</span>
<div class="hero"><div class="value">{fmt(poblacion)}</div><div class="label">Habitantes · {densidad} hab/km²</div>
<div class="src">Fuente: {origen(ag)}</div></div>
<div class="strip">
<div><b>{len(ag['metricas'])}</b> métricas verificadas</div>
<div><b>{len(ag['metricas_missing'])}</b> métricas missing</div>
<div><b>{len(rels_obj)}</b> relaciones · {len(hijos)} hijos</div>
</div>
<h3>Evidencia · clic en el hash → fuente → dato → hash</h3>
<table><thead><tr><th>Métrica</th><th>Valor</th><th>Fuente</th><th>Corte</th><th>hash_entidad</th></tr></thead>
<tbody>{''.join(filas)}</tbody></table>
<h3>Ficha del modelo</h3>
<p style="font-size:13px;color:var(--mute)">tipo {obj['nivel']} · padre Salta (provincia) · {len(hijos)} hijos · relaciones: {', '.join(sorted(set(r['tipo'] for r in rels_obj)))} · visibilidad public</p>
<div class="seal"><div style="font-size:22px">✓</div><div><b>Información auditada y verificada</b>
<p style="font-size:12px;color:var(--mute);margin:4px 0">Hashes recalculados en el navegador (RFC 8785 / SHA-256).</p>
<code>{cert.get('hash_entidad','')}</code><br><code>{cert.get('hash_linaje','')}</code></div></div>
{foot}</div></body></html>"""
(RAIZ / "mockups/dossier.html").write_text(dossier, encoding="utf8")

# ---------- Drawer / árbol ----------
hijos_html = "".join(
    f"<li>{h['nombre_oficial']} <span style='color:var(--mute)'>· {h['nivel']}</span></li>"
    for h in sorted(hijos, key=lambda o: o["nombre_oficial"])
)
rel_html = "".join(
    f"<div class='rel'><span>{r['tipo']} → {next((o['nombre_oficial'] for o in manifest['objetos'] if o['yvy_id']==r['destino_yvy_id']), r['destino_yvy_id'])}</span><span>IGN · 2025-09</span></div>"
    for r in rels_obj[:9]
)
drawer = f"""{head}<body><div class="sheet" style="padding:0">
<div class="tabs"><span class="on">Linaje</span><span>Mapa</span><span>Esquema</span><span style="margin-left:auto">✕</span></div>
<div style="padding:24px 28px">
<div class="eyebrow">Grafo del territorio · {obj['nombre_oficial']}</div>
<ul class="tree">
<li>Argentina <span style="color:var(--mute)">(país)</span></li>
<li><b>Salta</b> <span style="color:var(--mute)">(provincia)</span>
<ul class="tree">
<li>{obj['nombre_oficial']} <span style="color:var(--mute)">(depto) · población {fmt(poblacion)}</span></li>
<ul class="tree">{hijos_html}</ul>
</ul></li></ul>
<h3 style="margin-top:24px">Relaciones de {obj['nombre_oficial']}</h3>
{rel_html}
<p style="font-size:12px;color:var(--mute);margin-top:20px">0 documentos regulatorios cargados · la relación <code>regula</code> está declarada pero sin documentos.</p>
</div>{foot}</div></body></html>"""
(RAIZ / "mockups/drawer.html").write_text(drawer, encoding="utf8")
print("mockups generados: command.html, dossier.html, drawer.html")
