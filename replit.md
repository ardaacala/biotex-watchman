# BiotexWatchman

Fabrika çalışanlarının departman bazlı sabit çalışma planlarını, özel dönemlerini ve izin bakiyelerini yöneten İK uygulaması.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/vardiya-yonetimi` — React yönetim uygulaması
- `artifacts/api-server/src/routes/workforce.ts` — çalışan, plan, izin ve dashboard API işlemleri
- `lib/api-spec/openapi.yaml` — API sözleşmesinin kaynağı
- `lib/db/src/schema/workforce.ts` — personel ve planlama veri modeli

## Architecture decisions

- Normal çalışma saatleri departman bazında sabit plan olarak tutulur.
- İzin süresi yalnızca hafta içi günlerini sayar.
- Onaylanan yıllık izin çalışan bakiyesine eklenir; onay geri alınırsa bakiye düzeltilir.
- Özel dönemler departman, tarih aralığı ve geçici günlük saat düzeniyle tanımlanır.
- Çalışanlar uygulama kullanıcısı değildir; kayıtları İK tarafından yönetilir. Yalnızca yönetici ve İK kullanıcıları oturum açabilir.
- Google/SSO ve açık kayıt kullanılmaz; ilk yönetici hesabı yalnızca boş sistemdeki kurulum ekranından oluşturulur.

## Product

- Uygulamaya özel kullanıcı adı/şifre ile yönetici/İK girişi ve oturum korumalı personel verileri
- Aktif personel, planlanan/hedef saat, izindeki personel ve eksik mesai özeti
- Çalışan ekleme, düzenleme, arama ve aktif/pasif yönetimi
- Departman bazlı sabit çalışma planı ve tarih aralıklı özel dönem yönetimi
- Departman bazlı planlanan giriş/çıkış saatleri ile geç kalma, erken çıkış ve izin bakiyesi gösteren günlük devam takibi
- Yönetici tarafından eklenebilen, yeniden adlandırılabilen ve boşsa silinebilen merkezi departman yönetimi
- Personel bazında planlanan/gerçekleşen saat, giriş-çıkış, izin ve not geçmişi
- Gerçekleşen çalışma kayıtlarında önceki değerler silinmez; her yönetici değişikliği yapan kişi ve zaman bilgisiyle denetim geçmişine eklenir
- İzin talebi oluşturma, filtreleme, onaylama ve reddetme
- Son İK işlemlerinin aktivite akışı

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- OpenAPI değiştiğinde frontend veya backend tiplerini kullanmadan önce codegen çalıştırılmalıdır.
- Veritabanı şeması değiştiğinde geliştirme ortamında `pnpm --filter @workspace/db run push` çalıştırılmalıdır.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
