import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClockWidget } from "./clock-widget";

describe("ClockWidget", () => {
  it("shows the current time after mounting", async () => {
    render(<ClockWidget settings={{ hour12: false }} size={{ w: 2, h: 1 }} />);

    // The placeholder is replaced once the mount effect sets the time.
    await waitFor(() =>
      expect(screen.queryByText("--:--:--")).not.toBeInTheDocument(),
    );
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBeTruthy();
  });
});
