import type { ComponentContract, ResolvedAsset } from "../types";
import { isSafeHref } from "../safe-url";

/**
 * dot-stage-hero — a procedural, DOM-first motion hero.
 *
 * The readable content (h1, CTA, trust cue) is sharp DOM. A lime dot field is
 * drawn on an aria-hidden <canvas data-dot-stage> behind it, and a *display
 * word* is built out of dots. Because dot-built text is not real text, every
 * [data-dot-word] ships a matching [data-dot-twin] DOM node so crawlers and
 * screen readers still read the word. The engine is procedural (no stored
 * frames) and bypassed under prefers-reduced-motion.
 *
 * The two dot-specific guarantees (canvas_text_dom_twin, no_stored_frames) are
 * enforced by check-render-contract.ts, which self-scopes on the [data-dot-word]
 * and [data-dot-stage] markers emitted here.
 */

const ALLOWED_SCENE_PRESETS = [
  "spotlight-hero",
  "noise-to-order",
  "playhead-process",
  "lens-proof",
  "shape-pricing"
] as const;

export interface DotStageHeroInput {
  readonly props: {
    readonly headline?: string;
    readonly primary_cta?: string;
    readonly trust_cue?: string;
    readonly cta_href?: string;
    readonly display_word?: string;
    readonly scene_preset?: string;
    readonly motion_intensity?: string;
    readonly static_fallback_label?: string;
  };
  readonly slots: {
    readonly motion_background?: readonly ResolvedAsset[];
  };
  readonly contract: ComponentContract;
}

export interface DotStageHeroContractIssue {
  readonly code: string;
  readonly prop?: string;
  readonly message: string;
}

export class DotStageHeroContractError extends Error {
  readonly issues: readonly DotStageHeroContractIssue[];

  constructor(issues: readonly DotStageHeroContractIssue[]) {
    super(`dot-stage-hero contract failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    this.name = "DotStageHeroContractError";
    this.issues = issues;
  }
}

interface ValidDotStageHeroProps {
  readonly headline: string;
  readonly primary_cta: string;
  readonly trust_cue: string;
  readonly cta_href: string;
  readonly display_word: string;
  readonly scene_preset: string;
  readonly static_fallback_label: string;
}

export const dotStageHeroCss = `
.dot-stage-hero {
  container-type: inline-size;
  position: relative;
  min-height: min(760px, 100svh);
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-background);
  isolation: isolate;
}

.dot-stage-hero,
.dot-stage-hero * {
  box-sizing: border-box;
}

.dot-stage-hero__canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  display: block;
}

.dot-stage-hero__layout {
  position: relative;
  width: min(100%, 1180px);
  min-height: inherit;
  margin-inline: auto;
  padding: clamp(var(--space-6), 6cqi, calc(var(--space-8) * 2)) var(--space-6);
  display: grid;
  gap: var(--space-6);
  align-content: center;
  justify-items: center;
  text-align: center;
}

.dot-stage-hero__eyebrow {
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: 0.84rem;
  font-weight: var(--type-weight-bold);
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

.dot-stage-hero__wordmark {
  width: min(100%, 30rem);
  height: clamp(96px, 26cqi, 230px);
  margin: 0;
}

.dot-stage-hero__twin {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.dot-stage-hero h1 {
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

.dot-stage-hero__action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
}

.dot-stage-hero .cta {
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
  font-size: var(--pdos-type-body);
  font-weight: var(--type-weight-bold);
  line-height: 1;
  text-decoration: none;
}

.dot-stage-hero .cta:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 3px;
}

.dot-stage-hero__trust {
  max-width: 34ch;
  margin: 0;
  color: var(--color-muted-text);
  font-family: var(--type-font-body);
  font-size: var(--pdos-type-body);
  line-height: var(--type-line-height-body);
}

@media (max-width: 760px) {
  .dot-stage-hero {
    min-height: auto;
  }
  .dot-stage-hero__layout {
    padding: var(--space-8) var(--space-4);
  }
}

/* Reduced motion: the canvas engine bails to a single static frame (see script). */
@media (prefers-reduced-motion: reduce) {
  .dot-stage-hero__canvas {
    opacity: 0.85;
  }
}
`.trim();

export function renderDotStageHero(input: DotStageHeroInput): string {
  const issues = validateDotStageHeroInput(input);
  if (issues.length > 0) {
    throw new DotStageHeroContractError(issues);
  }

  const props = normalizeProps(input.props);

  return `
<section class="dot-stage-hero" data-pattern-id="dot-stage-hero" data-contract-id="${escapeAttribute(input.contract.id)}" data-scene-preset="${escapeAttribute(props.scene_preset)}" data-motion-strategy="procedural" aria-labelledby="dot-stage-hero-title">
  <canvas class="dot-stage-hero__canvas" data-dot-stage data-scene-preset="${escapeAttribute(props.scene_preset)}" aria-hidden="true"></canvas>
  <div class="dot-stage-hero__layout">
    <p class="dot-stage-hero__eyebrow" aria-hidden="true">V hlavní roli: vy</p>
    <p class="dot-stage-hero__wordmark" data-dot-word="${escapeAttribute(props.display_word)}" aria-hidden="true"></p>
    <span class="dot-stage-hero__twin" data-dot-twin="${escapeAttribute(props.display_word)}">${escapeHtml(props.display_word)}</span>
    <h1 id="dot-stage-hero-title" data-contract-prop="headline">${escapeHtml(props.headline)}</h1>
    <div class="dot-stage-hero__action-row">
      <a class="cta" data-contract-prop="primary_cta" href="${escapeAttribute(props.cta_href)}">${escapeHtml(props.primary_cta)}</a>
      <p class="dot-stage-hero__trust" data-contract-prop="trust_cue">${escapeHtml(props.trust_cue)}</p>
    </div>
  </div>
  ${renderDotEngineScript()}
</section>`.trim();
}

/**
 * Bounded procedural engine. Reads the display word from the [data-dot-word]
 * attribute (never interpolated into JS), so there is no script-injection
 * surface. Bails to one static frame under prefers-reduced-motion. No stored
 * frames, no image/video sources.
 */
function renderDotEngineScript(): string {
  const engine = `(function(){
  var section=document.currentScript&&document.currentScript.closest?document.currentScript.closest('.dot-stage-hero'):document.querySelector('.dot-stage-hero');
  if(!section)return;
  var cv=section.querySelector('[data-dot-stage]');
  var wordEl=section.querySelector('[data-dot-word]');
  if(!cv||!cv.getContext)return;
  var ctx=cv.getContext('2d');
  var word=wordEl?(wordEl.getAttribute('data-dot-word')||''):'';
  var scene=cv.getAttribute('data-scene-preset')||'spotlight-hero';
  var churn=scene==='noise-to-order'?2.1:1;
  var glowA=scene==='noise-to-order'?0.07:0.12;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  var mobile=window.matchMedia&&window.matchMedia('(max-width:760px)').matches;
  var DOTS=mobile?700:1200, LIME='200,255,50', dots=[], W=0,H=0, raf=0, running=false;
  function gauss(){return (Math.random()+Math.random()+Math.random()-1.5)/1.5;}
  function sampleWord(){
    if(!word)return [];
    var off=document.createElement('canvas');off.width=Math.max(2,cv.clientWidth||cv.width);off.height=Math.max(2,cv.clientHeight||cv.height);
    var oc=off.getContext('2d');oc.fillStyle='#000';oc.fillRect(0,0,off.width,off.height);
    oc.fillStyle='#fff';oc.textAlign='center';oc.textBaseline='middle';
    var fs=Math.floor(Math.min(off.height*0.6,off.width*0.9/Math.max(word.length,3)));
    oc.font='800 '+fs+'px ui-sans-serif,system-ui,sans-serif';
    var mw=oc.measureText(word).width, maxW=off.width*0.92;
    if(mw>maxW){fs=Math.max(10,Math.floor(fs*maxW/mw));oc.font='800 '+fs+'px ui-sans-serif,system-ui,sans-serif';}
    oc.fillText(word,off.width/2,off.height*0.32);
    var d=oc.getImageData(0,0,off.width,off.height).data,pts=[],step=Math.max(2,Math.floor(Math.sqrt(off.width*off.height/(DOTS*1.5))));
    for(var y=0;y<off.height;y+=step)for(var x=0;x<off.width;x+=step)if(d[(y*off.width+x)*4]>128)pts.push({x:x,y:y});
    return pts;
  }
  function seed(){
    dots.length=0;var word_pts=sampleWord();var budget=word_pts.length?Math.floor(DOTS*0.8):0;
    for(var i=0;i<DOTS;i++){
      var role=i<budget,hx,hy;
      if(role){var p=word_pts[Math.floor(i*word_pts.length/budget)];hx=p.x;hy=p.y;}
      else{hx=W*0.5+gauss()*W*0.36;hy=H*0.7+gauss()*H*0.26;}
      dots.push({hx:hx,hy:hy,role:role,ph:Math.random()*6.28,sp:0.15+Math.random()*0.25,amp:role?0.8:2.6*churn,r:role?(1.3+Math.random()):(0.8+Math.random()*0.8),a:role?(0.85+Math.random()*0.15):(0.12+Math.random()*0.22),x:Math.random()*W,y:Math.random()*H});
    }
  }
  function resize(){var dpr=Math.min(window.devicePixelRatio||1,mobile?1.25:1.5);W=cv.clientWidth||section.clientWidth;H=cv.clientHeight||section.clientHeight;cv.width=Math.floor(W*dpr);cv.height=Math.floor(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);seed();}
  function paint(t,live){
    ctx.globalCompositeOperation='source-over';ctx.fillStyle='#0a0d0a';ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    var g=ctx.createRadialGradient(W*0.5,H*0.34,0,W*0.5,H*0.34,Math.min(W,H)*0.34);
    g.addColorStop(0,'rgba('+LIME+','+glowA+')');g.addColorStop(1,'rgba('+LIME+',0)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    for(var i=0;i<dots.length;i++){var dn=dots[i];var bx=t?Math.cos(t*dn.sp+dn.ph)*dn.amp:0,by=t?Math.sin(t*dn.sp*0.9+dn.ph)*dn.amp:0;var tx=dn.hx+bx,ty=dn.hy+by;if(live){dn.x+=(tx-dn.x)*(dn.role?0.12:0.07);dn.y+=(ty-dn.y)*(dn.role?0.12:0.07);}else{dn.x=tx;dn.y=ty;}ctx.globalAlpha=dn.a;ctx.fillStyle='rgba('+LIME+',1)';ctx.beginPath();ctx.arc(dn.x,dn.y,dn.r,0,6.283);ctx.fill();}
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  }
  function loop(now){if(!running)return;paint(now*0.001,true);raf=requestAnimationFrame(loop);}
  function render(){if(reduce){running=false;cancelAnimationFrame(raf);paint(0,false);}else{if(!running){running=true;raf=requestAnimationFrame(loop);}}}
  document.addEventListener('visibilitychange',function(){if(document.hidden){running=false;cancelAnimationFrame(raf);}else render();});
  window.addEventListener('resize',function(){resize();render();});
  resize();render();
})();`;
  return `<script>${engine}</script>`;
}

function validateDotStageHeroInput(input: DotStageHeroInput): DotStageHeroContractIssue[] {
  const issues: DotStageHeroContractIssue[] = [];

  if (input.contract.target_kind !== "pattern" || input.contract.target_id !== "dot-stage-hero") {
    issues.push({
      code: "contract_mismatch",
      message: `Expected pattern contract for dot-stage-hero, received ${input.contract.target_kind}:${input.contract.target_id}.`
    });
  }

  validateRequiredTextProp(input, "headline", "visible_h1", issues);
  validateRequiredTextProp(input, "primary_cta", "dom_text_cta", issues);
  validateRequiredTextProp(input, "trust_cue", "proof_adjacency", issues);
  validateRequiredTextProp(input, "display_word", "canvas_text_dom_twin", issues);
  validateRequiredTextProp(input, "static_fallback_label", "reduced_motion_fallback", issues);
  validateScenePreset(input, issues);
  validateMotionIntensity(input, issues);
  validateCtaHref(input, issues);

  return issues;
}

function validateScenePreset(input: DotStageHeroInput, issues: DotStageHeroContractIssue[]): void {
  const contractProp = input.contract.props.find((prop) => prop.name === "scene_preset");
  const raw = input.props.scene_preset?.trim() ?? "";

  if (contractProp?.required === true && raw.length === 0) {
    issues.push({
      code: "scene_preset_required",
      prop: "scene_preset",
      message: `scene_preset is required by ${input.contract.id}.`
    });
    return;
  }

  if (raw.length > 0 && !(ALLOWED_SCENE_PRESETS as readonly string[]).includes(raw)) {
    issues.push({
      code: "scene_preset_not_allowed",
      prop: "scene_preset",
      message: `scene_preset must be one of: ${ALLOWED_SCENE_PRESETS.join(", ")}.`
    });
  }
}

function validateMotionIntensity(input: DotStageHeroInput, issues: DotStageHeroContractIssue[]): void {
  const contractProp = input.contract.props.find((prop) => prop.name === "motion_intensity");
  const raw = input.props.motion_intensity?.trim() ?? "";

  if (contractProp?.required === true && raw.length === 0) {
    issues.push({
      code: "motion_intensity_required",
      prop: "motion_intensity",
      message: `motion_intensity is required by ${input.contract.id}.`
    });
    return;
  }

  if (raw.length > 0 && !/^\d+$/.test(raw)) {
    issues.push({
      code: "motion_intensity_invalid",
      prop: "motion_intensity",
      message: "motion_intensity must be a non-negative integer (0-10 scale)."
    });
  }
}

function validateCtaHref(input: DotStageHeroInput, issues: DotStageHeroContractIssue[]): void {
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

function validateRequiredTextProp(
  input: DotStageHeroInput,
  propName: keyof DotStageHeroInput["props"],
  invariantCode: string,
  issues: DotStageHeroContractIssue[]
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

function normalizeProps(props: DotStageHeroInput["props"]): ValidDotStageHeroProps {
  const href = props.cta_href?.trim() || "#kontakt";
  const scene = props.scene_preset?.trim() || "spotlight-hero";
  return {
    headline: props.headline?.trim() ?? "",
    primary_cta: props.primary_cta?.trim() ?? "",
    trust_cue: props.trust_cue?.trim() ?? "",
    cta_href: href,
    display_word: props.display_word?.trim() ?? "",
    scene_preset: scene,
    static_fallback_label: props.static_fallback_label?.trim() ?? ""
  };
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
