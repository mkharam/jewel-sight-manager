// كاميرات الجهاز نفسه (FaceTime على الماك، آيفون عبر Continuity، Desk View) لا تُعرض هنا —
// هذه الشاشة للكاميرات الموصولة بـType-C/USB فقط.
export const isBuiltInCamera = (label: string) =>
  /facetime|built-?in|integrated|iphone|ipad|desk view|continuity/i.test(label);
