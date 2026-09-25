/* @ds-bundle: {"format":3,"namespace":"AtritoDesignSystem_04edc5","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Stat","sourcePath":"components/core/Stat.jsx"},{"name":"BreathRing","sourcePath":"components/feedback/BreathRing.jsx"},{"name":"FrictionSelector","sourcePath":"components/forms/FrictionSelector.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"AppRow","sourcePath":"components/lists/AppRow.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"915b499bf184","components/core/Button.jsx":"8d0eb250695c","components/core/Card.jsx":"e9924a3b6049","components/core/IconButton.jsx":"22040b0a4fae","components/core/Stat.jsx":"85a1202d3754","components/feedback/BreathRing.jsx":"2a627ece3cb7","components/forms/FrictionSelector.jsx":"18806567b503","components/forms/Switch.jsx":"a6877b791ce5","components/lists/AppRow.jsx":"9f420798a06b","ui_kits/atrito-app/AppsScreen.jsx":"a1e52f516f5b","ui_kits/atrito-app/BreathScreen.jsx":"526d39c12269","ui_kits/atrito-app/HomeScreen.jsx":"a09807d65fba","ui_kits/atrito-app/OnboardingScreen.jsx":"858382559628","ui_kits/atrito-app/StatsScreen.jsx":"ff0ddf77771d","ui_kits/atrito-app/icons.jsx":"32d0774f768f"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AtritoDesignSystem_04edc5 = window.AtritoDesignSystem_04edc5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito Badge / Tag — small monochrome label. Quiet by default.
 * `outline` for a hairline chip, `solid` for an inverted ink chip,
 * `eyebrow` for the sparse uppercase micro-label used as section markers.
 */
function Badge({
  variant = 'soft',
  children,
  style = {},
  ...rest
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'var(--font-sans)',
    whiteSpace: 'nowrap'
  };
  const variants = {
    soft: {
      padding: '5px 11px',
      fontSize: 'var(--fs-xs)',
      fontWeight: 'var(--fw-medium)',
      letterSpacing: 'var(--ls-snug)',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--bg-wash)',
      color: 'var(--text-secondary)'
    },
    outline: {
      padding: '5px 11px',
      fontSize: 'var(--fs-xs)',
      fontWeight: 'var(--fw-medium)',
      letterSpacing: 'var(--ls-snug)',
      borderRadius: 'var(--radius-pill)',
      background: 'transparent',
      color: 'var(--text-primary)',
      border: 'var(--border-hair) solid var(--border-default)'
    },
    solid: {
      padding: '5px 11px',
      fontSize: 'var(--fs-xs)',
      fontWeight: 'var(--fw-medium)',
      letterSpacing: 'var(--ls-snug)',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--ink-900)',
      color: 'var(--paper)'
    },
    eyebrow: {
      padding: 0,
      fontSize: 'var(--fs-xs)',
      fontWeight: 'var(--fw-medium)',
      letterSpacing: 'var(--ls-wider)',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito Button — calm, deliberate, monochrome.
 * Variants: solid (ink), outline, ghost, quiet. No color, ever.
 * Press feels slow; hover is a gentle wash.
 */
function Button({
  variant = 'solid',
  size = 'md',
  full = false,
  disabled = false,
  iconBefore = null,
  iconAfter = null,
  children,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: {
      padding: '0 16px',
      height: 40,
      fontSize: 'var(--fs-sm)'
    },
    md: {
      padding: '0 22px',
      height: 52,
      fontSize: 'var(--fs-body)'
    },
    lg: {
      padding: '0 28px',
      height: 60,
      fontSize: 'var(--fs-body-lg)'
    }
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: sizes[size].height,
    minHeight: 'var(--tap-min)',
    padding: sizes[size].padding,
    width: full ? '100%' : 'auto',
    fontFamily: 'var(--font-sans)',
    fontSize: sizes[size].fontSize,
    fontWeight: 'var(--fw-medium)',
    letterSpacing: 'var(--ls-snug)',
    borderRadius: 'var(--radius-md)',
    border: 'var(--border-medium) solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background var(--dur-base) var(--ease-calm), color var(--dur-base) var(--ease-calm), border-color var(--dur-base) var(--ease-calm), opacity var(--dur-base) var(--ease-calm)',
    opacity: disabled ? 0.4 : 1,
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none'
  };
  const variants = {
    solid: {
      background: 'var(--ink-900)',
      color: 'var(--paper)',
      borderColor: 'var(--ink-900)'
    },
    outline: {
      background: 'transparent',
      color: 'var(--text-primary)',
      borderColor: 'var(--border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-primary)',
      borderColor: 'transparent'
    },
    quiet: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      borderColor: 'transparent',
      fontWeight: 'var(--fw-regular)'
    }
  };
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const hoverStyle = !disabled && hover ? variant === 'solid' ? {
    background: 'var(--ink-700)',
    borderColor: 'var(--ink-700)'
  } : {
    background: 'var(--overlay-hover)'
  } : {};
  const pressStyle = !disabled && press ? {
    transform: 'scale(0.985)'
  } : {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      ...base,
      ...variants[variant],
      ...hoverStyle,
      ...pressStyle,
      transition: base.transition + ', transform var(--dur-fast) var(--ease-calm)',
      ...style
    }
  }, rest), iconBefore, children && /*#__PURE__*/React.createElement("span", null, children), iconAfter);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito Card — papery, flat surface. Structure comes from a hairline
 * border, not shadow. `sunken` for a quiet inset block; `inverse` for the
 * dark intercept aesthetic; `bare` for no border (whitespace-only grouping).
 */
function Card({
  variant = 'default',
  padding = 'var(--space-6)',
  children,
  style = {},
  ...rest
}) {
  const variants = {
    default: {
      background: 'var(--bg-surface)',
      border: 'var(--border-hair) solid var(--border-default)',
      color: 'var(--text-primary)'
    },
    sunken: {
      background: 'var(--bg-sunken)',
      border: 'var(--border-hair) solid transparent',
      color: 'var(--text-primary)'
    },
    inverse: {
      background: 'var(--ink-900)',
      border: 'var(--border-hair) solid rgba(255,255,255,0.10)',
      color: 'var(--paper)'
    },
    bare: {
      background: 'transparent',
      border: 'none',
      color: 'var(--text-primary)'
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      borderRadius: 'var(--radius-md)',
      padding,
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito IconButton — square, quiet, monochrome. For nav and toolbar glyphs.
 * Pass an SVG/glyph as children. Hover is a gentle wash, never a color.
 */
function IconButton({
  variant = 'ghost',
  size = 'md',
  label,
  disabled = false,
  children,
  style = {},
  ...rest
}) {
  const dims = {
    sm: 40,
    md: 48,
    lg: 56
  };
  const d = dims[size];
  const [hover, setHover] = React.useState(false);
  const variants = {
    ghost: {
      background: 'transparent',
      border: '1px solid transparent',
      color: 'var(--text-primary)'
    },
    outline: {
      background: 'transparent',
      border: 'var(--border-hair) solid var(--border-default)',
      color: 'var(--text-primary)'
    },
    solid: {
      background: 'var(--ink-900)',
      border: 'var(--border-hair) solid var(--ink-900)',
      color: 'var(--paper)'
    }
  };
  const hoverStyle = !disabled && hover ? variant === 'solid' ? {
    background: 'var(--ink-700)'
  } : {
    background: 'var(--overlay-hover)'
  } : {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: d,
      height: d,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'background var(--dur-base) var(--ease-calm)',
      WebkitTapHighlightColor: 'transparent',
      ...variants[variant],
      ...hoverStyle,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Stat.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito Stat — a large breathable metric. The number leads (mono, oversized),
 * with a quiet label above and optional caption below. The opposite of a
 * dopamine dashboard: no color, no arrows, no sparkline by default.
 */
function Stat({
  value,
  unit = null,
  label = null,
  caption = null,
  size = 'md',
  align = 'left',
  style = {},
  ...rest
}) {
  const sizes = {
    sm: 'var(--fs-h2)',
    md: 'var(--fs-h1)',
    lg: 'var(--fs-display)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      textAlign: align,
      ...style
    }
  }, rest), label && /*#__PURE__*/React.createElement("div", {
    className: "atrito-eyebrow",
    style: {
      marginBottom: 'var(--space-3)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "atrito-numeric",
    style: {
      fontSize: sizes[size],
      fontWeight: 'var(--fw-light)',
      lineHeight: 'var(--lh-tight)',
      letterSpacing: 'var(--ls-tight)',
      color: 'var(--text-primary)',
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: align === 'center' ? 'center' : 'flex-start',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", null, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '0.4em',
      fontWeight: 'var(--fw-regular)',
      letterSpacing: 'var(--ls-normal)',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-sans)'
    }
  }, unit)), caption && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-3)',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-secondary)',
      lineHeight: 'var(--lh-normal)'
    }
  }, caption));
}
Object.assign(__ds_scope, { Stat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Stat.jsx", error: String((e && e.message) || e) }); }

// components/feedback/BreathRing.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito BreathRing — the wait timer at the heart of an intercept screen.
 * A thin monochrome ring depletes over the wait. Optionally pulses with a
 * slow breathing cycle. Center holds the remaining seconds (mono).
 * Pure black & white — the ring is ink on the track.
 */
function BreathRing({
  size = 220,
  stroke = 2,
  progress = 0.4,
  // 0..1 remaining
  label = null,
  sublabel = null,
  breathing = false,
  inverse = false,
  style = {},
  ...rest
}) {
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const trackCol = inverse ? 'rgba(255,255,255,0.16)' : 'var(--ink-200)';
  const inkCol = inverse ? '#ffffff' : 'var(--ink-900)';
  const textCol = inverse ? '#ffffff' : 'var(--text-primary)';
  const subCol = inverse ? 'rgba(255,255,255,0.55)' : 'var(--text-secondary)';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: 'relative',
      width: size,
      height: size,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      animation: breathing ? 'atrito-breathe var(--dur-breath) var(--ease-inout) infinite' : 'none',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("style", null, `
        @keyframes atrito-breathe {
          0%, 100% { transform: scale(0.94); }
          50%      { transform: scale(1.0); }
        }
      `), /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: 'rotate(-90deg)'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: trackCol,
    strokeWidth: stroke
  }), /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: inkCol,
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeDasharray: c,
    strokeDashoffset: c * (1 - progress),
    style: {
      transition: 'stroke-dashoffset var(--dur-slow) linear'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      textAlign: 'center'
    }
  }, label != null && /*#__PURE__*/React.createElement("div", {
    className: "atrito-numeric",
    style: {
      fontSize: 'calc(' + size + 'px * 0.24)',
      fontWeight: 'var(--fw-light)',
      lineHeight: 'var(--lh-tight)',
      color: textCol
    }
  }, label), sublabel && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 'var(--fs-xs)',
      fontWeight: 'var(--fw-medium)',
      letterSpacing: 'var(--ls-wide)',
      textTransform: 'uppercase',
      color: subCol
    }
  }, sublabel)));
}
Object.assign(__ds_scope, { BreathRing });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/BreathRing.jsx", error: String((e && e.message) || e) }); }

// components/forms/FrictionSelector.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const LEVELS = [{
  key: 'low',
  label: 'Low',
  desc: 'A brief pause',
  marks: 1
}, {
  key: 'medium',
  label: 'Medium',
  desc: 'Wait + state intention',
  marks: 2
}, {
  key: 'high',
  label: 'High',
  desc: 'Wait, breathe, confirm',
  marks: 3
}];

/**
 * Atrito FrictionSelector — the signature control. Choose how much
 * deliberate friction stands between you and a monitored app. Levels are
 * distinguished by INK DENSITY (number of filled marks), never by hue.
 */
function FrictionSelector({
  value = 'medium',
  onChange,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "radiogroup",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      ...style
    }
  }, rest), LEVELS.map(lvl => {
    const active = value === lvl.key;
    return /*#__PURE__*/React.createElement("button", {
      key: lvl.key,
      type: "button",
      role: "radio",
      "aria-checked": active,
      onClick: () => onChange && onChange(lvl.key),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        width: '100%',
        textAlign: 'left',
        padding: '16px 18px',
        minHeight: 'var(--tap-min)',
        borderRadius: 'var(--radius-md)',
        border: `var(--border-medium) solid ${active ? 'var(--border-strong)' : 'var(--border-default)'}`,
        background: active ? 'var(--bg-sunken)' : 'transparent',
        cursor: 'pointer',
        transition: 'border-color var(--dur-base) var(--ease-calm), background var(--dur-base) var(--ease-calm)',
        WebkitTapHighlightColor: 'transparent'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        gap: 4,
        flex: '0 0 auto'
      }
    }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        width: 7,
        height: 22,
        borderRadius: 2,
        background: i < lvl.marks ? 'var(--ink-900)' : 'var(--ink-200)'
      }
    }))), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: 'var(--fs-body)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text-primary)'
      }
    }, lvl.label), /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-secondary)',
        marginTop: 2
      }
    }, lvl.desc)), /*#__PURE__*/React.createElement("span", {
      "aria-hidden": true,
      style: {
        width: 20,
        height: 20,
        flex: '0 0 auto',
        borderRadius: 'var(--radius-pill)',
        border: 'var(--border-medium) solid var(--border-strong)',
        background: active ? 'var(--ink-900)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 3px var(--paper)' : 'none',
        transition: 'background var(--dur-base) var(--ease-calm)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { FrictionSelector });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FrictionSelector.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Atrito Switch — monochrome toggle. Off is a hairline outline (empty),
 * on is a filled ink track. The thumb glides slowly. No color states.
 */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  style = {},
  ...rest
}) {
  const W = 52,
    H = 30,
    PAD = 3;
  const knob = H - PAD * 2;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      position: 'relative',
      width: W,
      height: H,
      flex: '0 0 auto',
      borderRadius: 'var(--radius-pill)',
      border: 'var(--border-medium) solid var(--border-strong)',
      background: checked ? 'var(--ink-900)' : 'transparent',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'background var(--dur-base) var(--ease-inout), border-color var(--dur-base) var(--ease-inout)',
      padding: 0,
      WebkitTapHighlightColor: 'transparent',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: PAD - 2,
      left: checked ? W - knob - PAD - 1 : PAD - 1,
      width: knob,
      height: knob,
      borderRadius: 'var(--radius-pill)',
      background: checked ? 'var(--paper)' : 'var(--ink-900)',
      transition: 'left var(--dur-base) var(--ease-inout), background var(--dur-base) var(--ease-inout)'
    }
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/lists/AppRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const MARKS = {
  low: 1,
  medium: 2,
  high: 3,
  off: 0
};

/**
 * Atrito AppRow — a monitored-app list row. Monochrome glyph tile (the app's
 * initial), name, current friction shown as density marks, and a trailing
 * control slot. No app brand colors — everything is ink on paper.
 */
function AppRow({
  name,
  glyph = null,
  // single char / ReactNode for the tile
  friction = 'medium',
  // low | medium | high | off
  meta = null,
  // small secondary text under the name
  trailing = null,
  // e.g. a <Switch/> or chevron
  onClick,
  style = {},
  ...rest
}) {
  const marks = MARKS[friction] ?? 0;
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: '14px 16px',
      minHeight: 'var(--tap-min)',
      borderRadius: 'var(--radius-md)',
      background: hover && onClick ? 'var(--overlay-hover)' : 'transparent',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'background var(--dur-base) var(--ease-calm)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      flex: '0 0 auto',
      borderRadius: 'var(--radius-sm)',
      border: 'var(--border-hair) solid var(--border-default)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 'var(--fs-title)',
      fontWeight: 'var(--fw-medium)',
      color: 'var(--text-primary)',
      background: 'var(--bg-sunken)'
    }
  }, glyph ?? (typeof name === 'string' ? name.charAt(0).toUpperCase() : '·')), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-body)',
      fontWeight: 'var(--fw-medium)',
      color: 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      gap: 3
    }
  }, [0, 1, 2].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 5,
      height: 5,
      borderRadius: 'var(--radius-pill)',
      background: i < marks ? 'var(--ink-900)' : 'var(--ink-200)'
    }
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-secondary)'
    }
  }, meta ?? (friction === 'off' ? 'Not guarded' : friction.charAt(0).toUpperCase() + friction.slice(1) + ' friction')))), trailing && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 0 auto'
    }
  }, trailing));
}
Object.assign(__ds_scope, { AppRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lists/AppRow.jsx", error: String((e && e.message) || e) }); }

// ui_kits/atrito-app/AppsScreen.jsx
try { (() => {
// Atrito — Monitored apps screen. List with per-app friction levels.
(function () {
  const React = window.React;
  const DS = window.AtritoDesignSystem_04edc5;
  const {
    AppRow,
    Switch,
    FrictionSelector,
    Button
  } = DS;
  const APPS = [{
    name: 'Instagram',
    friction: 'high',
    on: true
  }, {
    name: 'TikTok',
    friction: 'high',
    on: true
  }, {
    name: 'YouTube',
    friction: 'medium',
    on: true
  }, {
    name: 'X',
    friction: 'medium',
    on: true
  }, {
    name: 'Reddit',
    friction: 'low',
    on: true
  }, {
    name: 'Facebook',
    friction: 'off',
    on: false
  }];
  function AppsScreen({
    onIntercept
  }) {
    const [apps, setApps] = React.useState(APPS);
    const [editing, setEditing] = React.useState(null);
    const toggle = i => setApps(a => a.map((x, j) => j === i ? {
      ...x,
      on: !x.on,
      friction: !x.on ? 'medium' : 'off'
    } : x));
    const setFriction = lvl => setApps(a => a.map((x, j) => j === editing ? {
      ...x,
      friction: lvl
    } : x));
    return React.createElement('div', {
      style: {
        padding: '0 24px 40px'
      }
    }, React.createElement('div', {
      style: {
        paddingTop: 28,
        marginBottom: 28
      }
    }, React.createElement('div', {
      className: 'atrito-eyebrow'
    }, 'Guarded apps'), React.createElement('h2', {
      style: {
        fontSize: 'var(--fs-h2)',
        fontWeight: 300,
        marginTop: 10,
        letterSpacing: '-0.03em'
      }
    }, 'What needs a pause?'), React.createElement('p', {
      style: {
        fontSize: 'var(--fs-body)',
        color: 'var(--text-secondary)',
        marginTop: 12,
        lineHeight: 1.6
      }
    }, 'Choose how much friction stands between you and each app.')), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, apps.map((app, i) => React.createElement('div', {
      key: app.name
    }, React.createElement(AppRow, {
      name: app.name,
      friction: app.on ? app.friction : 'off',
      onClick: app.on ? () => setEditing(editing === i ? null : i) : undefined,
      trailing: React.createElement(Switch, {
        checked: app.on,
        onChange: () => toggle(i)
      })
    }), editing === i && app.on && React.createElement('div', {
      style: {
        padding: '4px 16px 20px'
      }
    }, React.createElement(FrictionSelector, {
      value: app.friction,
      onChange: setFriction
    })), i < apps.length - 1 && React.createElement('div', {
      style: {
        height: 1,
        background: 'var(--border-subtle)',
        margin: '0 16px'
      }
    })))), React.createElement('div', {
      style: {
        marginTop: 28
      }
    }, React.createElement(Button, {
      variant: 'outline',
      full: true,
      onClick: () => onIntercept && onIntercept('Instagram')
    }, 'Preview a pause')));
  }
  window.AppsScreen = AppsScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/atrito-app/AppsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/atrito-app/BreathScreen.jsx
try { (() => {
// Atrito — Breath / intercept screen. The signature friction moment.
// Dark, slow. A wait timer must elapse before "Open anyway" unlocks.
(function () {
  const React = window.React;
  const DS = window.AtritoDesignSystem_04edc5;
  const {
    BreathRing,
    Button
  } = DS;
  function BreathScreen({
    app = 'Instagram',
    wait = 12,
    onClose,
    onProceed
  }) {
    const [left, setLeft] = React.useState(wait);
    const [intention, setIntention] = React.useState('');
    React.useEffect(() => {
      if (left <= 0) return;
      const t = setTimeout(() => setLeft(n => n - 1), 1000);
      return () => clearTimeout(t);
    }, [left]);
    const unlocked = left <= 0;
    const progress = left / wait;
    return React.createElement('div', {
      className: 'atrito-dark atrito-enter',
      style: {
        position: 'absolute',
        inset: 0,
        background: 'var(--ink-900)',
        color: 'var(--paper)',
        display: 'flex',
        flexDirection: 'column',
        padding: '40px 28px'
      }
    },
    // top: app name + close
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, React.createElement('div', {
      className: 'atrito-eyebrow',
      style: {
        color: 'rgba(255,255,255,0.5)'
      }
    }, 'You\u2019re about to open'), React.createElement('button', {
      onClick: onClose,
      'aria-label': 'close',
      style: {
        background: 'none',
        border: 'none',
        color: 'rgba(255,255,255,0.6)',
        cursor: 'pointer',
        padding: 8,
        fontSize: 22,
        lineHeight: 1
      }
    }, '\u00d7')), React.createElement('div', {
      style: {
        fontSize: 'var(--fs-h2)',
        fontWeight: 300,
        marginTop: 6,
        letterSpacing: '-0.03em'
      }
    }, app),
    // center ring
    React.createElement('div', {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36
      }
    }, React.createElement(BreathRing, {
      size: 240,
      stroke: 2,
      inverse: true,
      breathing: !unlocked,
      progress: unlocked ? 1 : 1 - progress,
      label: unlocked ? '\u2713' : String(left),
      sublabel: unlocked ? 'you waited' : 'breathe in, breathe out'
    }), React.createElement('div', {
      style: {
        textAlign: 'center',
        maxWidth: 300
      }
    }, React.createElement('div', {
      style: {
        fontSize: 'var(--fs-body-lg)',
        lineHeight: 1.5,
        color: 'rgba(255,255,255,0.92)'
      }
    }, unlocked ? 'What do you want to do here?' : 'Take a moment. Notice the urge \u2014 it passes.')),
    // intention field, appears after wait
    unlocked && React.createElement('input', {
      value: intention,
      onChange: e => setIntention(e.target.value),
      placeholder: 'I\u2019m opening this to\u2026',
      style: {
        width: '100%',
        maxWidth: 320,
        background: 'transparent',
        border: 'none',
        borderBottom: '1.5px solid rgba(255,255,255,0.25)',
        color: 'var(--paper)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        padding: '12px 4px',
        textAlign: 'center',
        outline: 'none'
      }
    })),
    // actions
    React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }
    }, React.createElement(Button, {
      variant: 'outline',
      full: true,
      disabled: !unlocked,
      onClick: onProceed,
      style: {
        borderColor: 'rgba(255,255,255,0.55)',
        color: 'var(--paper)'
      }
    }, unlocked ? 'Open anyway' : 'Open anyway (' + left + 's)'), React.createElement(Button, {
      variant: 'solid',
      full: true,
      onClick: onClose,
      style: {
        background: 'var(--paper)',
        color: 'var(--ink-900)',
        borderColor: 'var(--paper)'
      }
    }, 'Step away')));
  }
  window.BreathScreen = BreathScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/atrito-app/BreathScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/atrito-app/HomeScreen.jsx
try { (() => {
// Atrito — Home screen. Calm overview: time reclaimed, streak, recent pauses.
(function () {
  const React = window.React;
  const DS = window.AtritoDesignSystem_04edc5;
  const I = window.AtritoIcons;
  const {
    Stat,
    Badge,
    BreathRing
  } = DS;
  function HomeScreen({
    onOpenApps
  }) {
    return React.createElement('div', {
      style: {
        padding: '0 24px 40px'
      }
    },
    // header
    React.createElement('div', {
      style: {
        paddingTop: 28,
        marginBottom: 40
      }
    }, React.createElement('div', {
      className: 'atrito-eyebrow'
    }, 'Monday · 29 June'), React.createElement('h2', {
      style: {
        fontSize: 'var(--fs-h2)',
        fontWeight: 300,
        marginTop: 10,
        letterSpacing: '-0.03em'
      }
    }, 'Good evening.')),
    // hero ring
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'center',
        margin: '8px 0 36px'
      }
    }, React.createElement(BreathRing, {
      size: 248,
      stroke: 2,
      progress: 0.74,
      label: '4:12',
      sublabel: 'reclaimed today'
    })),
    // streak line
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'center',
        marginBottom: 40
      }
    }, React.createElement(Badge, {
      variant: 'outline'
    }, '7 day detox streak')),
    // two small stats
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 1,
        background: 'var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        marginBottom: 36
      }
    }, React.createElement('div', {
      style: {
        background: 'var(--bg-page)',
        padding: '22px 20px'
      }
    }, React.createElement(Stat, {
      label: 'Opens avoided',
      value: '23',
      size: 'sm'
    })), React.createElement('div', {
      style: {
        background: 'var(--bg-page)',
        padding: '22px 20px'
      }
    }, React.createElement(Stat, {
      label: 'Pauses taken',
      value: '31',
      size: 'sm'
    }))),
    // recent
    React.createElement('div', {
      className: 'atrito-eyebrow',
      style: {
        marginBottom: 16
      }
    }, 'Recent pauses'), [{
      app: 'Instagram',
      outcome: 'Stepped away',
      time: '18:40'
    }, {
      app: 'TikTok',
      outcome: 'Stepped away',
      time: '16:05'
    }, {
      app: 'YouTube',
      outcome: 'Continued · 4 min',
      time: '12:22'
    }].map((r, i) => React.createElement('div', {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '15px 0',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, React.createElement('div', {
      style: {
        width: 8,
        height: 8,
        borderRadius: 999,
        background: r.outcome.startsWith('Stepped') ? 'var(--ink-900)' : 'var(--ink-300)'
      }
    }), React.createElement('div', {
      style: {
        flex: 1
      }
    }, React.createElement('div', {
      style: {
        fontSize: 'var(--fs-body)',
        fontWeight: 500
      }
    }, r.app), React.createElement('div', {
      style: {
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-secondary)',
        marginTop: 2
      }
    }, r.outcome)), React.createElement('div', {
      className: 'atrito-numeric',
      style: {
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-tertiary)'
      }
    }, r.time))));
  }
  window.HomeScreen = HomeScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/atrito-app/HomeScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/atrito-app/OnboardingScreen.jsx
try { (() => {
// Atrito — Onboarding. Explains the philosophy. Slow, one idea per screen.
(function () {
  const React = window.React;
  const DS = window.AtritoDesignSystem_04edc5;
  const {
    Button
  } = DS;
  const STEPS = [{
    eyebrow: 'Welcome to Atrito',
    title: 'The apps are designed to be hard to put down.',
    body: 'So we add a little friction back. A pause before you open them \u2014 just enough to choose, instead of reaching out of habit.'
  }, {
    eyebrow: 'How it works',
    title: 'A breath before the scroll.',
    body: 'When you open a guarded app, Atrito intercepts. You wait a few seconds, breathe, and decide whether you really want to go in.'
  }, {
    eyebrow: 'The point',
    title: 'We reward leaving, not staying.',
    body: 'No streaks for screen time. No badges for opening apps. Atrito only celebrates the moments you chose to step away.'
  }];
  function OnboardingScreen({
    onDone
  }) {
    const [i, setI] = React.useState(0);
    const step = STEPS[i];
    const last = i === STEPS.length - 1;
    return React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '56px 32px 40px',
        background: 'var(--bg-page)'
      }
    },
    // progress marks
    React.createElement('div', {
      style: {
        display: 'flex',
        gap: 6,
        marginBottom: 64
      }
    }, STEPS.map((_, j) => React.createElement('div', {
      key: j,
      style: {
        height: 3,
        flex: 1,
        borderRadius: 999,
        background: j <= i ? 'var(--ink-900)' : 'var(--ink-200)',
        transition: 'background var(--dur-base) var(--ease-calm)'
      }
    }))), React.createElement('div', {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }
    }, React.createElement('div', {
      className: 'atrito-eyebrow',
      style: {
        marginBottom: 24
      }
    }, step.eyebrow), React.createElement('h1', {
      key: 't' + i,
      className: 'atrito-enter',
      style: {
        fontSize: 'var(--fs-h1)',
        fontWeight: 300,
        letterSpacing: '-0.03em',
        lineHeight: 1.15
      }
    }, step.title), React.createElement('p', {
      key: 'b' + i,
      className: 'atrito-enter',
      style: {
        fontSize: 'var(--fs-body-lg)',
        color: 'var(--text-secondary)',
        lineHeight: 1.6,
        marginTop: 24
      }
    }, step.body)), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }
    }, React.createElement(Button, {
      variant: 'solid',
      full: true,
      onClick: () => last ? onDone() : setI(i + 1)
    }, last ? 'Begin' : 'Continue'), !last && React.createElement(Button, {
      variant: 'quiet',
      full: true,
      onClick: onDone
    }, 'Skip')));
  }
  window.OnboardingScreen = OnboardingScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/atrito-app/OnboardingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/atrito-app/StatsScreen.jsx
try { (() => {
// Atrito — Stats screen. Deliberately undramatic. Monochrome bars, no color, no dopamine.
(function () {
  const React = window.React;
  const DS = window.AtritoDesignSystem_04edc5;
  const {
    Stat,
    Badge
  } = DS;
  const WEEK = [{
    d: 'M',
    v: 0.3
  }, {
    d: 'T',
    v: 0.5
  }, {
    d: 'W',
    v: 0.2
  }, {
    d: 'T',
    v: 0.6
  }, {
    d: 'F',
    v: 0.45
  }, {
    d: 'S',
    v: 0.8
  }, {
    d: 'S',
    v: 0.7
  }];
  function StatsScreen() {
    return React.createElement('div', {
      style: {
        padding: '0 24px 40px'
      }
    }, React.createElement('div', {
      style: {
        paddingTop: 28,
        marginBottom: 36
      }
    }, React.createElement('div', {
      className: 'atrito-eyebrow'
    }, 'This week'), React.createElement('h2', {
      style: {
        fontSize: 'var(--fs-h2)',
        fontWeight: 300,
        marginTop: 10,
        letterSpacing: '-0.03em'
      }
    }, 'Quietly, it adds up.')),
    // headline stat
    React.createElement('div', {
      style: {
        marginBottom: 40
      }
    }, React.createElement(Stat, {
      label: 'Time reclaimed',
      value: '26:48',
      unit: 'this week',
      size: 'lg'
    })),
    // bar chart — monochrome, % of pauses where you stepped away
    React.createElement('div', {
      className: 'atrito-eyebrow',
      style: {
        marginBottom: 18
      }
    }, 'Pauses where you stepped away'), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
        height: 120,
        marginBottom: 10
      }
    }, WEEK.map((b, i) => React.createElement('div', {
      key: i,
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        height: '100%'
      }
    }, React.createElement('div', {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'flex-end',
        background: 'var(--bg-sunken)',
        borderRadius: 4,
        overflow: 'hidden'
      }
    }, React.createElement('div', {
      style: {
        width: '100%',
        height: b.v * 100 + '%',
        background: 'var(--ink-900)',
        borderRadius: 4,
        transition: 'height var(--dur-slow) var(--ease-calm)'
      }
    }))))), React.createElement('div', {
      style: {
        display: 'flex',
        gap: 10,
        marginBottom: 40
      }
    }, WEEK.map((b, i) => React.createElement('div', {
      key: i,
      style: {
        flex: 1,
        textAlign: 'center',
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-tertiary)'
      }
    }, b.d))),
    // breakdown rows
    React.createElement('div', {
      className: 'atrito-eyebrow',
      style: {
        marginBottom: 8
      }
    }, 'By app'), [{
      app: 'Instagram',
      avoided: '11',
      taken: '14'
    }, {
      app: 'TikTok',
      avoided: '8',
      taken: '9'
    }, {
      app: 'YouTube',
      avoided: '4',
      taken: '12'
    }].map((r, i) => React.createElement('div', {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 0',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, React.createElement('div', {
      style: {
        fontSize: 'var(--fs-body)',
        fontWeight: 500
      }
    }, r.app), React.createElement('div', {
      className: 'atrito-numeric',
      style: {
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-secondary)'
      }
    }, r.avoided + ' avoided · ' + r.taken + ' opened'))));
  }
  window.StatsScreen = StatsScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/atrito-app/StatsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/atrito-app/icons.jsx
try { (() => {
// Atrito icon set — thin 1.5px monochrome line icons (Lucide-family style).
// Strictly stroke-based, currentColor, no fills. Exported to window for the UI kit.
(function () {
  const React = window.React;
  const S = (paths, props = {}) => (size = 22, stroke = 1.5) => React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...props
  }, paths.map((d, i) => React.createElement('path', {
    key: i,
    d
  })));
  const Icons = {
    home: S(['M3 11l9-8 9 8', 'M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5']),
    shield: S(['M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z']),
    chart: S(['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2']),
    clock: S(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2']),
    wind: S(['M3 8h11a2.5 2.5 0 1 0-2.5-2.5', 'M3 12h15a2.5 2.5 0 1 1-2.5 2.5', 'M3 16h9a2.5 2.5 0 1 1-2.5 2.5']),
    leaf: S(['M11 20A7 7 0 0 1 4 13c0-5 4-9 16-9 0 9-4 13-9 13a4 4 0 0 1-4-4', 'M11 16c1-3 3-5 6-6']),
    chevron: S(['M9 6l6 6-6 6']),
    chevronL: S(['M15 6l-6 6 6 6']),
    close: S(['M18 6L6 18', 'M6 6l12 12']),
    check: S(['M20 6L9 17l-5-5']),
    plus: S(['M12 5v14', 'M5 12h14']),
    settings: S(['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9z']),
    moon: S(['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z']),
    arrowR: S(['M5 12h14', 'M13 6l6 6-6 6']),
    pause: S(['M10 4H6v16h4z', 'M18 4h-4v16h4z'])
  };
  window.AtritoIcons = Icons;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/atrito-app/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Stat = __ds_scope.Stat;

__ds_ns.BreathRing = __ds_scope.BreathRing;

__ds_ns.FrictionSelector = __ds_scope.FrictionSelector;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.AppRow = __ds_scope.AppRow;

})();
