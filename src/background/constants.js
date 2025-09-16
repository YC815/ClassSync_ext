export const ONECAMPUS = "https://app.1campus.net";
export const TSKIT = "https://tschoolkit.web.app";

export const DUMMY_PAYLOAD = {
  version: "1.0",
  weekStartISO: "2025-09-22",
  days: [
    { dateISO: "2025-09-22", slots: ["吉林基地", "在家中"] },
    { dateISO: "2025-09-23", slots: ["弘道基地", "在家中"] },
    { dateISO: "2025-09-24", slots: ["在家中", { location: "其他地點", customName: "實習公司" }] },
    { dateISO: "2025-09-25", slots: ["吉林基地", "弘道基地"] },
    { dateISO: "2025-09-26", slots: [{ location: "其他地點", customName: "圖書館" }, "在家中"] }
  ],
  placeWhitelist: ["弘道基地", "吉林基地", "在家中", "其他地點"]
};
