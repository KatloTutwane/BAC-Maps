/* The card's views: a stack in which the newest view slides in over the one
   below. Every view in the stack stays mounted (so a Directions view keeps
   its route and location while a picker is open on top of it); only the top
   one is shown. */
import { useLayoutEffect, useRef, useState } from "react";
import { Icon, useApp } from "./common.jsx";
import { SearchHead, SearchView, DirectoryView, PickHead, PickView } from "./views/SearchViews.jsx";
import PlaceView, { placeTitle } from "./views/PlaceView.jsx";
import DirectionsView from "./views/DirectionsView.jsx";
import { ProfileView, LessonView, lessonTitle, ClassFormView, classTitle } from "./views/ProfileViews.jsx";

/* Each view: a title (text, or a function of its params) and its body;
   a view with its own header (a search field) gives Head as well. */
export const VIEWS = {
  search: { title: "Search", Head: SearchHead, Body: SearchView },
  place: { title: placeTitle, Body: PlaceView },
  directions: { title: "Directions", Body: DirectionsView },
  pick: { title: (params) => (params.field === "from" ? "Choose start" : "Choose destination"), Head: PickHead, Body: PickView },
  directory: { title: "Directory", Body: DirectoryView },
  profile: { title: "Profile", Body: ProfileView },
  lesson: { title: lessonTitle, Body: LessonView },
  "class": { title: classTitle, Body: ClassFormView }
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function slide(el, from, to) {
  if (!el || reduceMotion.matches || !el.animate) return { finished: Promise.resolve() };
  // the view leaving fades out fully so the two never show through each other
  return el.animate([{ transform: from, opacity: from === "none" ? 1 : 0 }, { transform: to, opacity: to === "none" ? 1 : 0 }],
    { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
}
/* Run fn when a slide ends, or after its duration anyway: background tabs can
   hold animations back, and a view left showing would bleed through the card. */
function after(anim, fn) {
  let done = false;
  const once = () => { if (!done) { done = true; fn(); } };
  anim.finished.then(once, once);
  setTimeout(once, 280);
}
function focusView(el) {
  if (!el) return;
  const target = el.querySelector("#search-input") || el.querySelector(".view-title") || el.querySelector("button");
  if (target) target.focus({ preventScroll: true });
}

function ViewFrame({ entry, index }) {
  const app = useApp();
  const [local, setLocal] = useState({});           // state shared by this view's head and body
  const def = VIEWS[entry.name];
  const title = typeof def.title === "function" ? def.title(entry.params, app) : def.title;
  const props = { params: entry.params, entry: entry, local: local, setLocal: setLocal };
  return (
    <div className="view" data-view={entry.name} ref={(el) => app.registerView(entry.key, el)}>
      <div className="view-head">
        {index > 0 && <button type="button" className="icon-btn back" aria-label="Back" onClick={app.pop}><Icon name="back" /></button>}
        {def.Head ? (
          <>
            <h2 className="sr-only">{title}</h2>
            <def.Head {...props} />
          </>
        ) : <h2 className="view-title" tabIndex={-1}><span className="label-hi">{title}</span></h2>}
      </div>
      <div className="view-body"><def.Body {...props} /></div>
    </div>
  );
}

export default function ViewStack({ stack, focus }) {
  const app = useApp();
  const prev = useRef([]);
  useLayoutEffect(() => {
    const before = prev.current;
    if (before === stack) {                                         // a re-render inside a view: leave the stack alone
      if (focus.current) { focus.current = false; focusView(app.viewEl(stack[stack.length - 1] && stack[stack.length - 1].key)); }
      return;
    }
    prev.current = stack;
    const top = stack[stack.length - 1], lastTop = before[before.length - 1];
    stack.forEach((e) => { const el = app.viewEl(e.key); if (el) el.hidden = e !== top; });
    if (!top) return;
    const topEl = app.viewEl(top.key);
    if (lastTop && lastTop.key !== top.key) {
      if (before.some((e) => e.key === top.key)) {
        slide(topEl, "translateX(-30%)", "none");                 // back: the view below returns
      } else if (stack.some((e) => e.key === lastTop.key)) {
        const lastEl = app.viewEl(lastTop.key);                    // forward: slide over the last view, then hide it
        if (lastEl) lastEl.hidden = false;
        slide(topEl, "translateX(100%)", "none");
        after(slide(lastEl, "none", "translateX(-30%)"), () => {
          if (lastEl && prev.current[prev.current.length - 1] !== lastTop) lastEl.hidden = true;
        });
      } else if (stack.length > 1) {
        slide(topEl, "translateX(100%)", "none");                  // the top view swapped for another
      }
    }
    if (focus.current) { focus.current = false; focusView(topEl); }
  });
  return stack.map((e, i) => <ViewFrame key={e.key} entry={e} index={i} />);
}
