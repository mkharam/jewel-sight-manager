import { describe, it, expect } from "vitest";
import { matchPeople, skeleton, isShared } from "@/lib/teamMatch";

// أسماء حقيقية من التقييم وأمارسوفت (بلا أرقام).
const sellers = [
  { branch_code: "01", sman: "01", name: "AHMED", profile_id: "p-ahmed" },
  { branch_code: "01", sman: "02", name: "ABDUALLAH", profile_id: "p-abdullah" },
  { branch_code: "01", sman: "03", name: "MOHAIMEN", profile_id: "p-mohaimen" },
  { branch_code: "01", sman: "04", name: "بيعة مشتركة" },
  { branch_code: "02", sman: "01", name: "GAZI" },
  { branch_code: "02", sman: "02", name: "MALEK" },
  { branch_code: "02", sman: "03", name: "MOAD" },
  { branch_code: "02", sman: "04", name: "SHOP" },
  { branch_code: "02", sman: "00", name: "SIRAG" },
  { branch_code: "03", sman: "01", name: "علي عمورة" },
  { branch_code: "03", sman: "02", name: "امحمد الهمالي" },
  { branch_code: "03", sman: "03", name: "عبد الرحمن القمودي" },
  { branch_code: "03", sman: "04", name: "بيعة مشتركة جرابة" },
  { branch_code: "05", sman: "01", name: "محمد" },
  { branch_code: "05", sman: "02", name: "امحمد" },
  { branch_code: "05", sman: "03", name: "اشرف" },
  { branch_code: "05", sman: "04", name: "محل" },
  { branch_code: "05", sman: "05", name: "اشرف و محمد" },
  { branch_code: "05", sman: "06", name: "محمد وامحمد" },
  { branch_code: "05", sman: "07", name: "اشرف وامحمد" },
];
const people = [
  { id: "abdullah", name: "عبدالله", branch_code: "01", profile_id: "p-abdullah" },
  { id: "mohaimen", name: "مهيمن", branch_code: "01", profile_id: "p-mohaimen" },
  { id: "ahmed", name: "احمد", branch_code: "01", profile_id: "p-ahmed" },
  { id: "ali", name: "علي", branch_code: "03", profile_id: "p-x" },
  { id: "abdelrahman", name: "عبدالرحمن", branch_code: "03", profile_id: "p-y" },
  { id: "mhmd03", name: "امحمد", branch_code: "03", profile_id: "p-z" },
  { id: "malek", name: "مالك", branch_code: "02", profile_id: "p-m" },
  { id: "moad", name: "معاد", branch_code: "02" },
  { id: "gazi", name: "غازي", branch_code: "02" },
  { id: "mhmd05", name: "امحمد", branch_code: "05" },
  { id: "mohamed05", name: "محمد", branch_code: "05" },
  { id: "ashraf", name: "اشرف", branch_code: "05" },
];

describe("ربط موظفين التقييم ببائعين أمارسوفت", () => {
  const m = matchPeople(people, sellers);
  it("بالحساب، وبالاسم، وبأول اسم، وبالحروف للأسماء اللاتينية", () => {
    expect(Object.fromEntries(m)).toEqual({
      abdullah: "01|02", mohaimen: "01|03", ahmed: "01|01",
      ali: "03|01", abdelrahman: "03|03", mhmd03: "03|02",
      malek: "02|02", moad: "02|03", gazi: "02|01",
      mhmd05: "05|02", mohamed05: "05|01", ashraf: "05|03",
    });
  });
  it("البيعات المشتركة ما تتربطش بحد", () => {
    const linked = new Set(m.values());
    for (const k of ["01|04", "02|04", "05|04", "05|05", "05|06", "05|07"]) expect(linked.has(k)).toBe(false);
    expect(isShared("اشرف و محمد")).toBe(true);
    expect(isShared("محمد وليد")).toBe(false);
  });
  it("هيكل الحروف", () => {
    expect(skeleton("AHMED")).toBe(skeleton("احمد"));
    expect(skeleton("ABDUALLAH")).toBe(skeleton("عبدالله"));
    expect(skeleton("SIRAG")).toBe(skeleton("سراج"));
  });
});
