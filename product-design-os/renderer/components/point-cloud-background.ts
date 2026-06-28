import type { ComponentContract, ResolvedAsset } from "../types";
import { isSafeHref } from "../safe-url";
import {
  POINT_CLOUD_SCENE_BUDGETS,
  validatePointCloudScene,
  type PointCloudSceneDeclaration
} from "../check-point-cloud-scene";
import type { EncodedPointCloud } from "../../../src/lib/image-point-cloud";

/**
 * point-cloud-background — a DOM-first 2.5D point-cloud background section.
 *
 * Readable content (h1, CTA, trust cue) is sharp DOM. Behind it, an aria-hidden
 * <canvas data-point-cloud> renders a faithful image→point-cloud (the asset's
 * EncodedPointCloud) as a depth field with pointer/scroll parallax. The cloud
 * payload ships as PLAIN-TEXT JSON inside <script type="application/json"
 * data-dot-cloud> — never a data: URI (which would trip no_stored_frames).
 *
 * The canvas is stamped [data-point-cloud][data-cloud-contract] so the
 * undeclared_scene_blob safety net in check-render-contract.ts recognises it as
 * a validated cloud. The full scene is gated by validatePointCloudScene
 * (check-point-cloud-scene.ts): budgets, provenance, depth, declared-text twins,
 * and reduced-motion. This pattern is decorative-by-construction: it carries no
 * readable text in the canvas, so the offer/headline live entirely in DOM.
 */

export interface PointCloudBackgroundInput {
  readonly props: {
    readonly eyebrow?: string;
    readonly headline?: string;
    readonly primary_cta?: string;
    readonly trust_cue?: string;
    readonly cta_href?: string;
    readonly static_fallback_label?: string;
    readonly parallax_gain?: string;
    readonly scene_preset?: string;
  };
  readonly slots: {
    readonly point_cloud?: readonly ResolvedAsset[];
  };
  readonly contract: ComponentContract;
}

/**
 * The four choreography knobs (brainstorm: topology × physics carry ~80% of the
 * distinctiveness; color/density are the brand skin). They are bounded ENUMS, not
 * free floats — the author picks a named preset, the engine maps each knob to
 * fixed motion params. Physics constants and depth limits are fixed by the
 * platform; density/color are brand-skinnable; topology is the formation.
 */
export const POINT_CLOUD_SCENE_PRESETS = {
  "architectural-grid": { topology: "grid", physics: "crystalline", density: "sparse", color: "mono", relief: "none", line: "off" },
  "photographic-drift": { topology: "edge", physics: "floaty", density: "dense", color: "faithful", relief: "none", line: "off" },
  "wordmark-gather": { topology: "gather", physics: "magnetic", density: "medium", color: "duotone", relief: "none", line: "off" },
  "lens-bokeh": { topology: "edge", physics: "heavy", density: "dense", color: "faithful", relief: "none", line: "off" },
  "flow-field": { topology: "flow", physics: "floaty", density: "medium", color: "duotone", relief: "none", line: "off" },
  "aurora-drift": { topology: "edge", physics: "floaty", density: "medium", color: "aurora", relief: "none", line: "off" },
  "depth-field": { topology: "edge", physics: "heavy", density: "dense", color: "depth-temp", relief: "none", line: "off" },
  "pastel-bokeh": { topology: "edge", physics: "floaty", density: "dense", color: "pastel", relief: "none", line: "off" },
  "topographic-relief": { topology: "edge", physics: "heavy", density: "sparse", color: "mono", relief: "topo", line: "off" },
  "lowpoly-facet": { topology: "edge", physics: "floaty", density: "lowpoly", color: "faithful", relief: "none", line: "off" },
  "edge-wire": { topology: "edge", physics: "floaty", density: "sparse", color: "faithful", relief: "none", line: "wire" },
  "blueprint-ribs": { topology: "grid", physics: "crystalline", density: "medium", color: "mono", relief: "none", line: "ribs" }
} as const;

export type ScenePresetId = keyof typeof POINT_CLOUD_SCENE_PRESETS;

export const ALLOWED_SCENE_PRESETS: readonly string[] = Object.keys(POINT_CLOUD_SCENE_PRESETS);

const DEFAULT_SCENE_PRESET: ScenePresetId = "photographic-drift";

export interface PointCloudBackgroundContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

export class PointCloudBackgroundContractError extends Error {
  readonly issues: readonly PointCloudBackgroundContractIssue[];

  constructor(issues: readonly PointCloudBackgroundContractIssue[]) {
    super(`point-cloud-background contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "PointCloudBackgroundContractError";
    this.issues = issues;
  }
}

interface ValidProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly primary_cta: string;
  readonly trust_cue: string;
  readonly cta_href: string;
  readonly static_fallback_label: string;
  readonly parallaxGain: string;
  readonly scenePreset: string;
}

export const pointCloudBackgroundCss = `
.point-cloud-bg {
  container-type: inline-size;
  position: relative;
  min-height: min(760px, 100svh);
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-background);
  isolation: isolate;
}

.point-cloud-bg,
.point-cloud-bg * {
  box-sizing: border-box;
}

.point-cloud-bg__canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  display: block;
}

.point-cloud-bg__layout {
  position: relative;
  width: min(100%, 1180px);
  min-height: inherit;
  margin-inline: auto;
  padding: clamp(var(--space-6), 6cqi, calc(var(--space-8) * 2)) var(--space-6);
  display: grid;
  gap: var(--space-6);
  align-content: center;
  justify-items: start;
}

.point-cloud-bg__eyebrow {
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: 0.84rem;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

.point-cloud-bg h1 {
  max-width: 22ch;
  margin: 0;
  font-family: var(--type-font-heading);
  font-size: clamp(1.9rem, 5.4cqi, 3.6rem);
  line-height: 1.07;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0;
  text-transform: var(--style-heading-transform);
  color: var(--color-text);
}

.point-cloud-bg__action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.point-cloud-bg .cta {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-accent);
  border-radius: var(--style-corner-radius);
  color: var(--color-accent-text);
  background: var(--color-accent);
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-bold);
  line-height: 1;
  text-decoration: none;
}

.point-cloud-bg .cta:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
}

.point-cloud-bg__trust {
  max-width: 34ch;
  margin: 0;
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--type-size-body);
  line-height: var(--type-line-height-body);
}

@media (max-width: 760px) {
  .point-cloud-bg { min-height: auto; }
  .point-cloud-bg__layout { padding: var(--space-8) var(--space-4); }
}

/* Reduced motion: the engine paints one static home-pose frame and attaches no
   pointer/scroll parallax listeners (see script). */
@media (prefers-reduced-motion: reduce) {
  .point-cloud-bg__canvas { opacity: 0.9; }
}
`.trim();

export function renderPointCloudBackground(input: PointCloudBackgroundInput): string {
  const cloudAsset = firstCloudAsset(input.slots.point_cloud);
  const inlineJson = cloudAsset?.dataRef?.inline;
  const issues = validateInput(input, inlineJson);
  if (issues.length > 0) {
    throw new PointCloudBackgroundContractError(issues);
  }

  const props = normalizeProps(input.props);
  // inlineJson is guaranteed present once validation passes.
  const cloudJson = escapeScriptJson(inlineJson ?? "");
  const knobs = POINT_CLOUD_SCENE_PRESETS[props.scenePreset as ScenePresetId] ?? POINT_CLOUD_SCENE_PRESETS[DEFAULT_SCENE_PRESET];
  const seed = varietySeed(props.headline);

  const html = `
<section class="point-cloud-bg" data-pattern-id="point-cloud-background" data-contract-id="${escapeAttribute(input.contract.id)}" data-scene-preset="${escapeAttribute(props.scenePreset)}" data-motion-strategy="procedural" aria-labelledby="point-cloud-bg-title">
  <canvas class="point-cloud-bg__canvas" data-point-cloud data-cloud-contract="${escapeAttribute(input.contract.id)}" data-scene-preset="${escapeAttribute(props.scenePreset)}" data-topology="${knobs.topology}" data-physics="${knobs.physics}" data-density="${knobs.density}" data-color="${knobs.color}" data-relief="${knobs.relief}" data-line="${knobs.line}" data-parallax-gain="${escapeAttribute(props.parallaxGain)}" data-seed="${escapeAttribute(seed)}" aria-hidden="true"></canvas>
  <script type="application/json" data-dot-cloud>${cloudJson}</script>
  <div class="point-cloud-bg__layout">
    ${props.eyebrow.length > 0 ? `<p class="point-cloud-bg__eyebrow">${escapeHtml(props.eyebrow)}</p>` : ""}
    <h1 id="point-cloud-bg-title" data-contract-prop="headline">${escapeHtml(props.headline)}</h1>
    <div class="point-cloud-bg__action-row">
      <a class="cta" data-contract-prop="primary_cta" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.primary_cta)}</a>
      <p class="point-cloud-bg__trust" data-contract-prop="trust_cue">${escapeHtml(props.trust_cue)}</p>
    </div>
  </div>
  ${renderEngineScript()}
</section>`.trim();

  // Fail-closed scene gate on the renderer's OWN output, so every render path
  // (renderComposition, pdos:render, production) is gated — not only tests.
  assertSceneGate(inlineJson ?? "", props, html);

  return html;
}

/**
 * Runs validatePointCloudScene on the just-rendered HTML. The pattern is
 * decorative-by-construction (text_payload: []), the canvas is aria-hidden, the
 * engine guards prefers-reduced-motion, and the cloud is internally authored, so
 * a budget/depth/reduced-motion violation is the only way this throws — exactly
 * the fail-closed behaviour we want during generation. Provenance for
 * source-recorded clouds stays gated at the asset-adoption layer.
 */
function assertSceneGate(inlineJson: string, props: ValidProps, html: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inlineJson);
  } catch {
    throw new PointCloudBackgroundContractError([
      { code: "point_cloud_payload_invalid", message: "point_cloud dataRef is not valid JSON." }
    ]);
  }

  if (!isCompleteEncodedPointCloud(parsed)) {
    throw new PointCloudBackgroundContractError([
      {
        code: "point_cloud_payload_invalid",
        message: "point_cloud payload is not a complete EncodedPointCloud (missing positions/colors/stats)."
      }
    ]);
  }

  const declaration: PointCloudSceneDeclaration = {
    role: "decorative",
    aria_hidden: true,
    animated: true,
    parallax_gain: Number(props.parallaxGain) || 0,
    text_payload: [],
    static_fallback: { label: props.static_fallback_label },
    // Provenance is gated in render-composition; this internal lane is structural-only.
    source: { provenance: "internal" }
  };

  const report = validatePointCloudScene({ scene: { encoded: parsed, declaration }, html });
  if (report.errors.length > 0) {
    throw new PointCloudBackgroundContractError(
      report.errors.map((issue) => ({ code: issue.code, message: issue.message }))
    );
  }
}

function isCompleteEncodedPointCloud(value: unknown): value is EncodedPointCloud {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.positions !== "string" || typeof v.colors !== "string" || typeof v.pointCount !== "number") {
    return false;
  }
  const stats = v.stats;
  if (typeof stats !== "object" || stats === null) {
    return false;
  }
  const s = stats as Record<string, unknown>;
  const options = s.optionsSummary as { depthAmp?: unknown } | undefined;
  const bbox = s.bbox as { min?: { z?: unknown }; max?: { z?: unknown } } | undefined;
  const histogram = s.colorHistogram as { bucketCount?: unknown; top?: unknown } | undefined;
  const dims = s.dims as { width?: unknown; height?: unknown } | undefined;
  return (
    options !== undefined && typeof options.depthAmp === "number" &&
    bbox !== undefined && typeof bbox.min?.z === "number" && typeof bbox.max?.z === "number" &&
    histogram !== undefined && typeof histogram.bucketCount === "number" && Array.isArray(histogram.top) &&
    dims !== undefined && typeof dims.width === "number" && typeof dims.height === "number"
  );
}

/**
 * Bounded procedural engine. Reads the EncodedPointCloud from the
 * [data-dot-cloud] JSON script (never interpolated into JS — parsed from
 * textContent), decodes base64 positions/colors, and paints a depth-sorted 2.5D
 * field. Settles from a scattered start to the home pose once, then PARKS;
 * pointer/scroll only nudge a coalesced repaint. Under prefers-reduced-motion it
 * paints one home-pose frame and attaches no motion listeners.
 */
function renderEngineScript(): string {
  const engine = `(function(){
  var s=document.currentScript&&document.currentScript.closest?document.currentScript.closest('.point-cloud-bg'):null;
  if(!s)s=document.querySelector('.point-cloud-bg');
  if(!s)return;
  var cv=s.querySelector('[data-point-cloud]'),dataEl=s.querySelector('[data-dot-cloud]');
  if(!cv||!cv.getContext||!dataEl)return;
  var ctx=cv.getContext('2d'),cloud;
  try{cloud=JSON.parse(dataEl.textContent||'null');}catch(e){return;}
  if(!cloud||!cloud.pointCount)return;
  function bytes(b){b=b||'';var bin=atob(b),n=bin.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i);return u;}
  var pos=bytes(cloud.positions),dv=new DataView(pos.buffer,pos.byteOffset,pos.byteLength),col=bytes(cloud.colors),hasSz=!!cloud.sizes,sz=hasSz?bytes(cloud.sizes):null;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  var mobile=window.matchMedia&&window.matchMedia('(max-width:760px)').matches;
  var GAIN=parseFloat(cv.getAttribute('data-parallax-gain')||'1');if(!(GAIN>=0))GAIN=1;
  var topo=cv.getAttribute('data-topology')||'edge',SEED=parseInt(cv.getAttribute('data-seed')||'0',10)||0;
  var RELIEF={none:0,soft:5,topo:6,ridge:8},reliefN=RELIEF[cv.getAttribute('data-relief')||'none']||0;
  var PHYS={crystalline:{dur:650,par:0.5,k:10,ov:0},heavy:{dur:1150,par:0.8,k:7,ov:0},magnetic:{dur:820,par:1,k:9,ov:0.12},floaty:{dur:1300,par:1.4,k:5,ov:0}};
  var DENS={sparse:{st:3,sz:1.7},medium:{st:2,sz:1.15},dense:{st:1,sz:0.85},lowpoly:{st:1,sz:1.9}};
  var ph=PHYS[cv.getAttribute('data-physics')]||PHYS.floaty,de=DENS[cv.getAttribute('data-density')]||DENS.dense,colMode=cv.getAttribute('data-color')||'faithful';
  function toRgb(str){try{var d=document.createElement('span');d.style.color=(str||'').trim()||'#888';d.style.display='none';(document.body||document.documentElement).appendChild(d);var c=getComputedStyle(d).color;if(d.parentNode)d.parentNode.removeChild(d);var m=c.match(/(\\d+)\\D+(\\d+)\\D+(\\d+)/);return m?[+m[1],+m[2],+m[3]]:[136,136,136];}catch(e){return [136,136,136];}}
  var cstyle=getComputedStyle(s),accent=toRgb(cstyle.getPropertyValue('--color-accent')||'#88ccff'),bgc=toRgb(cstyle.getPropertyValue('--color-background')||'#0a0d0a'),accent2=toRgb(cstyle.getPropertyValue('--color-accent-secondary')||cstyle.getPropertyValue('--color-accent')||'#88ccff');
  function mix(a,b,t){return 'rgb('+Math.round(a[0]+(b[0]-a[0])*t)+','+Math.round(a[1]+(b[1]-a[1])*t)+','+Math.round(a[2]+(b[2]-a[2])*t)+')';}
  function colorOf(r,g,b,z){if(colMode==='faithful')return 'rgb('+r+','+g+','+b+')';var L=(0.2126*r+0.7152*g+0.0722*b)/255;if(colMode==='mono')return 'rgb('+accent[0]+','+accent[1]+','+accent[2]+')';if(colMode==='aurora')return L<0.5?mix(bgc,accent2,L*2):mix(accent2,accent,(L-0.5)*2);if(colMode==='depth-temp')return mix(accent2,accent,Math.max(0,Math.min(1,0.5+z*0.5)));if(colMode==='pastel')return 'rgb('+Math.min(255,Math.round(r*0.5+accent[0]*0.45)+38)+','+Math.min(255,Math.round(g*0.5+accent[1]*0.45)+38)+','+Math.min(255,Math.round(b*0.5+accent[2]*0.45)+38)+')';return mix(bgc,accent,L);}
  var LINE={off:{a:0,w:0},wire:{a:0.16,w:0.6},ribs:{a:0.26,w:1}},ln=LINE[cv.getAttribute('data-line')]||LINE.off;
  var EG=(ln.a>0&&cloud.edges)?bytes(cloud.edges):null,edv=EG?new DataView(EG.buffer,EG.byteOffset,EG.byteLength):null,EN=EG?(EG.length>>2):0;
  var lineRgb='rgba('+accent[0]+','+accent[1]+','+accent[2]+','+ln.a+')',MAXSEG=mobile?1200:2400;
  var lowpoly=cv.getAttribute('data-density')==='lowpoly'&&cloud.facetPositions&&cloud.facetCount,pts=[];
  if(lowpoly){var fp=bytes(cloud.facetPositions),fd=new DataView(fp.buffer,fp.byteOffset,fp.byteLength),fc=bytes(cloud.facetColors),FN=cloud.facetCount;
    for(var i=0;i<FN;i++){var fx=i*12;pts.push({x:fd.getFloat32(fx,true),y:fd.getFloat32(fx+4,true),z:fd.getFloat32(fx+8,true),sp:2.4,fill:colorOf(fc[i*3]||0,fc[i*3+1]||0,fc[i*3+2]||0,fd.getFloat32(fx+8,true)),ox:(((((i*2654435761)>>>0)^(SEED>>>0))>>>0)%1000)/1000-0.5,oy:(((((i*40503)>>>0)^((SEED*7+1)>>>0))>>>0)%1000)/1000-0.5});}}
  else{var N=cloud.pointCount,stride=Math.max(de.st,mobile?2:1);
    for(var i=0;i<N;i+=stride){var bx=i*12;pts.push({x:dv.getFloat32(bx,true),y:dv.getFloat32(bx+4,true),z:dv.getFloat32(bx+8,true),sp:hasSz?(sz[i]||1):1,fill:colorOf(col[i*3]||0,col[i*3+1]||0,col[i*3+2]||0,dv.getFloat32(bx+8,true)),ox:(((((i*2654435761)>>>0)^(SEED>>>0))>>>0)%1000)/1000-0.5,oy:(((((i*40503)>>>0)^((SEED*7+1)>>>0))>>>0)%1000)/1000-0.5});}}
  var W=0,H=0,raf=0,px=0,py=0,sc=0,t0=0,DUR=ph.dur,scheduled=false;
  function ease(t){var e=1-Math.pow(2,-ph.k*t);if(ph.ov)e+=ph.ov*Math.sin(Math.min(1,t)*Math.PI);return e;}
  function startPos(p,hx,hy,cx,cy){if(topo==='gather')return [cx,cy];if(topo==='edge')return [cx+(hx-cx)*1.4,cy+(hy-cy)*1.4];if(topo==='flow')return [hx-W*0.45,hy+p.oy*H*0.15];if(topo==='grid')return [hx+p.ox*W*0.18,cy-H*0.62+p.oy*H*0.08];return [cx+p.ox*W,cy+p.oy*H];}
  function resize(){var dpr=Math.min(window.devicePixelRatio||1,mobile?1.5:2);W=cv.clientWidth||s.clientWidth||1;H=cv.clientHeight||s.clientHeight||1;cv.width=Math.max(1,Math.floor(W*dpr));cv.height=Math.max(1,Math.floor(H*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);}
  function homePose(p,cx,cy,scale){var depth=0.55+(p.z+0.5)*0.9;return [cx+p.x*scale*depth,cy-p.y*scale*depth,depth];}
  function frame(prog){
    ctx.clearRect(0,0,W,H);
    var cx=W/2,cy=H/2,scale=Math.min(W,H)*0.9;
    for(var i=0;i<pts.length;i++){var p=pts[i];
      var hp=homePose(p,cx,cy,scale),hx=hp[0],hy=hp[1],depth=hp[2];
      var pr=GAIN*ph.par,tx=hx+px*p.z*pr*(mobile?8:14),ty=hy+(py+sc)*p.z*pr*(mobile?6:10),dx,dy;
      if(prog<1){var e=ease(prog),sp0=startPos(p,hx,hy,cx,cy);dx=sp0[0]+(tx-sp0[0])*e;dy=sp0[1]+(ty-sp0[1])*e;}else{dx=tx;dy=ty;}
      var rad;
      if(reliefN>0){var bb=p.z*reliefN,ring=1-Math.min(1,Math.abs(bb-Math.round(bb))*2.2);ctx.globalAlpha=Math.min(1,0.14+(p.z+0.5)*0.55+ring*0.35);rad=Math.max(0.4,(p.sp*0.5+0.4)*depth*de.sz*(1+ring*0.7));}
      else{ctx.globalAlpha=Math.min(1,0.18+(p.z+0.5)*0.7);rad=Math.max(0.4,(p.sp*0.5+0.4)*depth*de.sz);}
      ctx.fillStyle=p.fill;
      ctx.beginPath();ctx.arc(dx,dy,rad,0,6.283);ctx.fill();
    }
    if(prog>=1&&edv&&ln.a>0){var pr2=GAIN*ph.par,projXY=function(i){var bx=i*12,x=dv.getFloat32(bx,true),y=dv.getFloat32(bx+4,true),z=dv.getFloat32(bx+8,true),dp=0.55+(z+0.5)*0.9;return [cx+x*scale*dp+px*z*pr2*(mobile?8:14),cy-y*scale*dp+(py+sc)*z*pr2*(mobile?6:10)];};
      ctx.strokeStyle=lineRgb;ctx.lineWidth=ln.w;ctx.globalAlpha=ln.a;var seg=Math.min(EN,MAXSEG);ctx.beginPath();for(var e=0;e<seg;e++){var ea=edv.getUint16(e*4,true),eb=edv.getUint16(e*4+2,true);if(ea>=cloud.pointCount||eb>=cloud.pointCount)continue;var pa=projXY(ea),pb=projXY(eb);ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);}ctx.stroke();}
    ctx.globalAlpha=1;
  }
  function repaint(){scheduled=false;frame(1);}
  function schedule(){if(scheduled||reduce)return;scheduled=true;requestAnimationFrame(repaint);}
  function settle(now){if(!t0)t0=now;var prog=Math.min(1,(now-t0)/DUR);frame(prog);if(prog<1)raf=requestAnimationFrame(settle);else raf=0;}
  function start(){resize();if(reduce){frame(1);return;}t0=0;cancelAnimationFrame(raf);raf=requestAnimationFrame(settle);}
  if(!reduce){
    window.addEventListener('pointermove',function(e){px=(e.clientX/(window.innerWidth||1)-0.5)*2;py=(e.clientY/(window.innerHeight||1)-0.5)*2;schedule();},{passive:true});
    window.addEventListener('scroll',function(){var r=s.getBoundingClientRect();sc=Math.max(-1,Math.min(1,-r.top/(window.innerHeight||1)));schedule();},{passive:true});
    document.addEventListener('visibilitychange',function(){if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{schedule();}});
  }
  window.addEventListener('resize',function(){resize();if(reduce)frame(1);else schedule();});
  start();
})();`;
  return `<script>${engine}</script>`;
}

function firstCloudAsset(assets: readonly ResolvedAsset[] | undefined): ResolvedAsset | undefined {
  return assets?.find((asset) => asset.targetKind === "asset");
}

function validateInput(input: PointCloudBackgroundInput, inlineJson: string | undefined): PointCloudBackgroundContractIssue[] {
  const issues: PointCloudBackgroundContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "point-cloud-background") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for point-cloud-background, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, "headline", "visible_h1", issues);
  validateRequiredTextProp(input, "primary_cta", "dom_text_cta", issues);
  validateRequiredTextProp(input, "trust_cue", "proof_adjacency", issues);
  validateRequiredTextProp(input, "static_fallback_label", "reduced_motion_fallback", issues);
  validateCtaHref(input, issues);
  validateParallaxGain(input, issues);
  validateScenePreset(input, issues);
  validateCloudPayload(inlineJson, issues);

  return issues;
}

function validateScenePreset(input: PointCloudBackgroundInput, issues: PointCloudBackgroundContractIssue[]): void {
  const contractProp = input.contract.props.find((prop) => prop.name === "scene_preset");
  const raw = input.props.scene_preset?.trim() ?? "";

  if (contractProp?.required === true && raw.length === 0) {
    issues.push({ code: "scene_preset_required", prop: "scene_preset", message: `scene_preset is required by ${input.contract.id}.` });
    return;
  }

  if (raw.length > 0 && !ALLOWED_SCENE_PRESETS.includes(raw)) {
    issues.push({
      code: "scene_preset_not_allowed",
      prop: "scene_preset",
      message: `scene_preset must be one of: ${ALLOWED_SCENE_PRESETS.join(", ")}.`
    });
  }
}

/** Deterministic per-site variety seed so two sites with the same preset and
 *  cloud still diverge (entrance scatter + offsets are seeded by it). */
function varietySeed(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0);
}

function validateCloudPayload(inlineJson: string | undefined, issues: PointCloudBackgroundContractIssue[]): void {
  if (inlineJson === undefined || inlineJson.trim().length === 0) {
    issues.push({
      code: "point_cloud_slot_missing",
      message: "point-cloud-background requires a point_cloud asset with an inline dataRef (the EncodedPointCloud JSON)."
    });
    return;
  }

  let pointCount = 0;
  try {
    const parsed = JSON.parse(inlineJson) as { readonly pointCount?: unknown };
    pointCount = typeof parsed.pointCount === "number" ? parsed.pointCount : 0;
  } catch {
    issues.push({ code: "point_cloud_payload_invalid", message: "point_cloud dataRef is not valid JSON." });
    return;
  }

  if (pointCount <= 0) {
    issues.push({ code: "point_cloud_payload_invalid", message: "point_cloud payload has no points." });
    return;
  }

  if (pointCount > POINT_CLOUD_SCENE_BUDGETS.maxPoints) {
    issues.push({
      code: "cloud_pointcount_over_budget",
      message: `point_cloud has ${pointCount} points, over the ${POINT_CLOUD_SCENE_BUDGETS.maxPoints} inline budget.`
    });
  }
}

function validateCtaHref(input: PointCloudBackgroundInput, issues: PointCloudBackgroundContractIssue[]): void {
  const rawHref = input.props.cta_href;
  if (rawHref === undefined || rawHref.trim().length === 0) {
    return;
  }
  if (!isSafeHref(rawHref)) {
    issues.push({
      code: "unsafe_href",
      prop: "cta_href",
      message: "cta_href must use #, /, ./, ../, http(s), mailto, or tel."
    });
  }
}

function validateParallaxGain(input: PointCloudBackgroundInput, issues: PointCloudBackgroundContractIssue[]): void {
  const raw = input.props.parallax_gain?.trim() ?? "";
  if (raw.length === 0) {
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    issues.push({
      code: "parallax_gain_invalid",
      prop: "parallax_gain",
      message: "parallax_gain must be a finite, non-negative number."
    });
  }
}

function validateRequiredTextProp(
  input: PointCloudBackgroundInput,
  propName: keyof PointCloudBackgroundInput["props"],
  invariantCode: string,
  issues: PointCloudBackgroundContractIssue[]
): void {
  const contractProp = input.contract.props.find((prop) => prop.name === propName);
  const minLength = contractProp?.min_length ?? 1;
  const rawValue = input.props[propName];
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (contractProp?.required === true && value.length === 0) {
    issues.push({ code: invariantCode, prop: propName, message: `${propName} is required by ${input.contract.id}.` });
    return;
  }

  if (value.length < minLength) {
    issues.push({ code: invariantCode, prop: propName, message: `${propName} must be at least ${minLength} characters.` });
  }
}

function normalizeProps(props: PointCloudBackgroundInput["props"]): ValidProps {
  const href = props.cta_href?.trim() || "#kontakt";
  const gain = props.parallax_gain?.trim() || "1";
  return {
    eyebrow: props.eyebrow?.trim() ?? "",
    headline: props.headline?.trim() ?? "",
    primary_cta: props.primary_cta?.trim() ?? "",
    trust_cue: props.trust_cue?.trim() ?? "",
    cta_href: href,
    static_fallback_label: props.static_fallback_label?.trim() ?? "",
    parallaxGain: gain,
    scenePreset: props.scene_preset?.trim() || DEFAULT_SCENE_PRESET
  };
}

/** Neutralise the only HTML-significant sequence inside a JSON script body. */
function escapeScriptJson(value: string): string {
  return value.replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
