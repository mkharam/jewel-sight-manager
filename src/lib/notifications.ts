// وصف أحداث activity_log وتصفيتها حسب من يعنيه الأمر.
//
// كان الجرس يعرض سجل النشاط كما هو للجميع بلا فرق: الموظف في فرع يرى تغييرات فروع
// أخرى لا تخصّه، ويرى أفعاله هو معادة عليه، بينما أحداث كثيرة لا تُعرض أصلاً لأن
// describe() لم تكن تعرف شكلها. هذا الملف يعالج الاثنين معاً.
import {
  ArrowLeftRight, Tag, MessageCircle, Package, PackagePlus, Trash2, Pencil,
  ClipboardCheck, Receipt, Undo2, MapPin,
} from "lucide-react";

export interface ActivityItem {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
  actor_id: string | null;
  actor_name?: string;
}

const STATUS_LABEL: Record<string, string> = {
  status_approved: "وافق على التحويل",
  status_in_transit: "أرسل التحويل",
  status_received: "استلم التحويل",
  status_rejected: "رفض التحويل",
  status_cancelled: "ألغى التحويل",
  created: "أنشأ",
};

const PRODUCT_STATUS_AR: Record<string, string> = {
  available: "متوفرة",
  reserved: "محجوزة",
  sold: "مباعة",
  transferred: "محوّلة",
  damaged: "تالفة",
  lost: "مفقودة",
  archived: "مؤرشفة",
  in_repair: "في الصيانة",
  stock_discrepancy: "فرق جرد",
};

const money = (n: any) => (typeof n === "number" ? n.toLocaleString("en-US") : n);

/**
 * نوع الكيان يُكتب أحياناً بالمفرد (product) وأحياناً بالجمع (products) حسب الموضع الذي
 * سجّل الحدث. نوحّده هنا بدل مطاردة كل موضع إدراج على حدة — التسجيلات القديمة في
 * قاعدة البيانات لا يمكن تغييرها بأثر رجعي على أي حال.
 */
function normalizeEntity(t: string): string {
  return t === "product" ? "products" : t === "sale" ? "sales" : t === "transfer" ? "transfers" : t;
}

export function describe(a: ActivityItem): { text: string; icon: any; href: string; image?: string | null } | null {
  const actor = a.actor_name ?? "موظف";
  const type = normalizeEntity(a.entity_type);
  const d = a.details ?? {};

  if (type === "transfers") {
    const product = d.product ?? "قطعة";
    if (a.action === "created") return { text: `${actor} طلب تحويل: ${product}`, icon: ArrowLeftRight, href: "/transfers" };
    if (STATUS_LABEL[a.action]) return { text: `${actor} ${STATUS_LABEL[a.action]}: ${product}`, icon: ArrowLeftRight, href: "/transfers" };
    return null;
  }

  if (type === "products") {
    const name = d.name ?? "قطعة";
    const href = a.entity_id ? `/products/${a.entity_id}` : "/";
    // إضافة قطعة تُعرض بصورتها لا بأيقونة: المدير يتعرّف على البضاعة الجديدة من شكلها
    // أسرع من قراءة اسمٍ ولّده التحليل التلقائي. راجع logProductCreated في uploadRunner.
    if (a.action === "created") return { text: `${actor} أضاف قطعة: ${name}`, icon: Package, href, image: d.image ?? null };
    // كانت هذه الأفعال الثلاثة أكثر ما يُسجَّل فعلياً ولا يظهر منها شيء في الجرس.
    if (a.action === "delete") return { text: `${actor} حذف القطعة: ${name}`, icon: Trash2, href: "/" };
    if (a.action === "update") return { text: `${actor} عدّل القطعة: ${name}`, icon: Pencil, href };
    if (a.action === "verify") return { text: `${actor} تحقّق من قطعة في الجرد`, icon: ClipboardCheck, href };
    if (a.action === "location_changed") return { text: `${actor} نقل «${name}» إلى موقع آخر`, icon: MapPin, href };
    if (a.action === "quote") {
      return {
        text: `${actor} سجّل سعر ${money(d.price)} د.ل${d.customer ? ` للزبون ${d.customer}` : ""}`,
        icon: Tag,
        href,
      };
    }
    if (a.action?.startsWith("status_")) {
      const next = a.action.replace("status_", "");
      const label = PRODUCT_STATUS_AR[next] ?? next;
      if (next === "sold") return { text: `${actor} باع القطعة: ${name} 🎉`, icon: Tag, href };
      return { text: `${actor} حدّث حالة ${name} إلى ${label}`, icon: Package, href };
    }
    return null;
  }

  if (type === "product_quotes") {
    return {
      text: `${actor} سجّل سعر ${money(d.price)} د.ل${d.customer ? ` للزبون ${d.customer}` : ""}`,
      icon: Tag,
      href: d.product_id ? `/products/${d.product_id}` : "/",
    };
  }

  if (type === "sales") {
    if (a.action === "sold") return { text: `${actor} باع «${d.product ?? "قطعة"}» بـ ${money(d.price)} د.ل 🎉`, icon: Receipt, href: "/sales" };
    if (a.action === "sale_returned") {
      const href = d.product_id ? `/products/${d.product_id}` : "/sales";
      return { text: `${actor} أرجع بيعة بقيمة ${money(d.final_price)} د.ل`, icon: Undo2, href };
    }
    return null;
  }

  if (type === "customer_inquiries") {
    return { text: `${actor} سجّل استفسار${d.customer ? ` من ${d.customer}` : ""}`, icon: MessageCircle, href: "/inquiries" };
  }

  if (type === "product_reorder_requests") {
    const product = d.product ?? "قطعة";
    if (a.action === "reorder_requested") return { text: `${actor} طلب إعادة طلب: ${product}`, icon: PackagePlus, href: "/reorders" };
    if (a.action === "reorder_ordered") return { text: `تم طلب «${product}» من المورد`, icon: PackagePlus, href: "/reorders" };
    if (a.action === "reorder_received") return { text: `وصلت «${product}» 🎉`, icon: PackagePlus, href: "/reorders" };
    if (a.action === "reorder_cancelled") return { text: `أُلغي طلب إعادة طلب: ${product}`, icon: PackagePlus, href: "/reorders" };
    return null;
  }

  return null;
}

/**
 * البيع يُسجَّل مرتين: مرة على sales ومرة كتغيّر حالة على products — فيظهر إشعاران
 * متطابقان للحدث نفسه. نُبقي رواية sales لأنها تحمل السعر، ونُسقط تغيّر الحالة إن جاء
 * معها في الدقيقة نفسها. تغيير الحالة إلى «مباعة» من قائمة البطاقة السريعة (بلا سطر
 * بيع) يبقى ظاهراً لأنه لن يجد له قريناً.
 */
const SALE_DEDUPE_WINDOW_MS = 60_000;
export function dropDuplicateSaleEvents(list: ActivityItem[]): ActivityItem[] {
  const saleTimes = list
    .filter((a) => normalizeEntity(a.entity_type) === "sales" && a.action === "sold")
    .map((a) => new Date(a.created_at).getTime());
  if (saleTimes.length === 0) return list;
  return list.filter((a) => {
    if (normalizeEntity(a.entity_type) !== "products" || a.action !== "status_sold") return true;
    const t = new Date(a.created_at).getTime();
    return !saleTimes.some((st) => Math.abs(st - t) <= SALE_DEDUPE_WINDOW_MS);
  });
}

export interface RelevanceContext {
  userId: string | null;
  branchId: string | null;
  isAdmin: boolean;
}

/** أي فرع يخصّ هذا الحدث، إن كان يخصّ فرعاً بعينه. */
function branchesOf(a: ActivityItem): (string | null | undefined)[] {
  const d = a.details ?? {};
  const type = normalizeEntity(a.entity_type);
  if (type === "transfers") return [d.from, d.to];
  return [d.branch_id, d.new_branch_id, d.old_branch_id];
}

/**
 * هل يعني هذا الحدثُ هذا المستخدم؟
 *
 * المدير العام يرى كل شيء — هو من طلب أن يرى كل شيء. الموظف والمشرف يريان ما يخصّ
 * فرعهما، إضافةً إلى ما يهمّ المحلات كلها بطبيعته: الاستفسارات (زبون يدوّر على قطعة
 * قد تكون عندك)، ونتائج طلبات إعادة الطلب (البضاعة وصلت أو أُلغيت). ولا أحد يُشعَر
 * بفعل قام به هو بنفسه.
 */
export function isRelevant(a: ActivityItem, ctx: RelevanceContext): boolean {
  // حدث بلا فاعل: أثر عملية صيانة/دفعة على قاعدة البيانات لا فعلَ موظف — أرشفة دفعة
  // الاختبار وحدها ولّدت مئات الأسطر عبر مُشغِّل تغيّر الحالة، فتدفن كل ما سواها.
  // لا أحد يحتاج إشعاراً بها.
  if (!a.actor_id) return false;
  if (ctx.userId && a.actor_id === ctx.userId) return false;
  if (ctx.isAdmin) return true;

  const type = normalizeEntity(a.entity_type);

  // يهمّ الجميع بصرف النظر عن الفرع
  if (type === "customer_inquiries") return true;
  if (type === "product_reorder_requests") {
    // «طلب إعادة طلب» قرارٌ ينتظر المدير — لا فائدة منه لبقية الموظفين. أما نتيجته
    // (طُلبت / وصلت / أُلغيت) فتهمّ كل من قد يبيع القطعة.
    return a.action !== "reorder_requested";
  }

  // ضجيج الجرد: نقل قطعة بين واجهات العرض والتحقّق منها يتكرّران عشرات المرات في
  // جلسة جرد واحدة ويُغرقان الشريط. يبقيان في سجل النشاط للمدير العام دون سواه.
  if (type === "products" && (a.action === "location_changed" || a.action === "verify")) return false;

  // "بيعت هذه القطعة" مقصودة أن تبقى للمدير العام وحده — من باعها وبكم مبلغ ليس شأن
  // بقية الموظفين، حتى في فرعهم هم. من يبحث عن القطعة يجدها "مباعة" في الكتالوج عادةً
  // (بلا سرّية)؛ هذا فقط يمنع دفع الحدث كإشعار نشط. لا يشمل الإرجاع (sale_returned) —
  // ذاك يهمّ الفرع لأن القطعة عادت للمخزون فيها.
  if ((type === "sales" && a.action === "sold") || (type === "products" && a.action === "status_sold")) {
    return false;
  }

  const branches = branchesOf(a).filter(Boolean);
  // حدث بلا انتماء لفرع (تسعيرة مثلاً) — لا نُغرق به موظفي الفروع الأخرى.
  if (branches.length === 0) return false;
  return !!ctx.branchId && branches.includes(ctx.branchId);
}
