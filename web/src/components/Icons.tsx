// Линейные иконки, толщина 2 px.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 24): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

const mk = (d: JSX.Element) =>
  function Icon({ size, ...rest }: P) {
    return (
      <svg {...base(size)} {...rest}>
        {d}
      </svg>
    );
  };

export const IconTree = mk(
  <>
    <path d="M12 3l5 6h-3l4 5h-3.5l3.5 4H6l3.5-4H6l4-5H7z" />
    <path d="M12 18v3" />
  </>,
);
export const IconHeart = mk(<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />);
export const IconGift = mk(
  <>
    <rect x="3.5" y="8" width="17" height="4" rx="1" />
    <path d="M5 12v8h14v-8M12 8v12" />
    <path d="M12 8c-1.5-3-5-4-5-1.5C7 8 12 8 12 8zM12 8c1.5-3 5-4 5-1.5C17 8 12 8 12 8z" />
  </>,
);
export const IconChat = mk(<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h0a2 2 0 0 1-2-2z" />);
export const IconUser = mk(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </>,
);
export const IconPlus = mk(<path d="M12 5v14M5 12h14" />);
export const IconClose = mk(<path d="M6 6l12 12M18 6L6 18" />);
export const IconLink = mk(
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>,
);
export const IconExternal = mk(
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </>,
);
export const IconEdit = mk(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />);
export const IconTrash = mk(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />);
export const IconCamera = mk(
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </>,
);
export const IconSend = mk(<path d="M4 12l16-8-6 16-2.5-6.5z" />);
export const IconCopy = mk(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </>,
);
export const IconShare = mk(<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />);
export const IconArrow = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconSwap = mk(<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />);
export const IconBell = mk(<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />);
export const IconLock = mk(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);
export const IconEye = mk(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconShuffle = mk(<path d="M4 7h3.5c4 0 5 10 9 10H20M4 17h3.5c1.5 0 2.5-1.4 3.3-3M16.5 7H20M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5M13.2 10c.8-1.6 1.8-3 3.3-3" />);
export const IconCrown = mk(<path d="M4 18h16M5 15l-1-9 5 4 3-6 3 6 5-4-1 9z" />);
export const IconImage = mk(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <circle cx="9" cy="9.5" r="1.5" />
    <path d="M20 15l-4.5-4.5L6 20" />
  </>,
);
export const IconEnvelope = mk(
  <>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3.5 7l8.5 6.5L20.5 7" />
  </>,
);
