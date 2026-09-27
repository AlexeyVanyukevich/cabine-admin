import type { Intent } from './intents'

/**
 * Why the engine refused, in the owner's language and in terms of what they should do next.
 *
 * Deliberately separate from `errors.ts`: the same code means something different here. On a
 * form, `slot_unavailable` means "pick other nights". In the queue it also has to say that the
 * booking they wrote down half a day ago does not exist.
 *
 * Every entry here is a code `POST /api/bookings` (this server's own create route) can
 * actually answer with — traced against `server/src/modules/bookings/booking.service.ts` and
 * the engine's own `create` path in `../booking-engine`. Transitions and holds
 * (`invalid_state_transition`, `hold_expired`) live on other routes this queue never calls, so
 * they are deliberately left out rather than guessed at. Anything not listed — including a
 * future code neither project has yet — falls through to `GENERIC`, which is safe precisely
 * because it names no cause: it never has to be right about *why*, only honest that nothing was
 * booked.
 */
const REASONS: Record<string, string> = {
  slot_unavailable:
    'Эти ночи заняли, пока телефон был без сети. Бронь не заведена — выберите другие даты или другой дом.',
  outside_schedule: 'Эти даты вне расписания дома. Бронь не заведена.',
  resource_inactive: 'Дом закрыт для брони. Бронь не заведена.',
  invalid_interval: 'Даты заезда и выезда не сошлись. Бронь не заведена — выберите даты заново.',
  idempotency_key_reused:
    'Эту бронь уже отправляли с другими данными. Заведите её заново, чтобы не задвоить.',
  invalid_phone: 'Номер телефона не принят. Поправьте его и отправьте снова.',
  validation_error: 'Сервер не принял данные брони. Проверьте поля и отправьте снова.',
  not_found: 'Дом больше не существует. Бронь не заведена.',
  // A fault in how this server talks to the engine, not in anything the owner typed — the
  // generic line below would send them hunting for a typo that isn't there.
  engine_rejected_our_key:
    'Сервис бронирования сейчас настроен неверно — это не ваша ошибка. Бронь не заведена. Сообщите тому, кто отвечает за настройку, и попробуйте снова.',
}

const GENERIC =
  'Сервер не принял эту бронь. Бронь не заведена — проверьте данные и попробуйте снова.'

export function conflictReason(intent: Intent): string {
  return REASONS[intent.lastError?.code ?? ''] ?? GENERIC
}
