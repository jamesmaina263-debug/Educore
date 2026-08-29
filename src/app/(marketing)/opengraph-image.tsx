import { ImageResponse } from "next/og";

// Generated at build/request time with next/og -- no external image asset
// to source or invent. Uses only the approved brand tokens (Navy/Gold,
// see MARKETING_SITE_STATUS.md Section 4) and the same "EduCore" wordmark
// text used elsewhere on the site. Applies to every route under
// (marketing)/ that doesn't define its own opengraph-image.
export const alt = "EduCore — School management platform for Kenyan schools";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "80px",
          backgroundColor: "#0A1730",
          backgroundImage:
            "linear-gradient(135deg, #0A1730 0%, #060C1F 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <div
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "4px",
              backgroundColor: "#D9A627",
              display: "flex",
            }}
          />
          <span
            style={{
              fontSize: "34px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#F2D182",
            }}
          >
            EduCore
          </span>
        </div>
        <div
          style={{
            marginTop: "48px",
            fontSize: "58px",
            fontWeight: 700,
            color: "#FFFFFF",
            lineHeight: 1.15,
            maxWidth: "920px",
            display: "flex",
          }}
        >
          School operations, brought into one connected platform.
        </div>
        <div
          style={{
            marginTop: "32px",
            fontSize: "26px",
            color: "rgba(255,255,255,0.65)",
            display: "flex",
          }}
        >
          Admissions · Academics · Finance · Communication · Kenya
        </div>
      </div>
    ),
    { ...size },
  );
}
