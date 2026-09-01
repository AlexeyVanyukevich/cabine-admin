import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, ApiError, type House } from '../api'
import { Screen } from '../ui/Screen'
import { money, toMinor, toRoubles } from '../calendar/nights'
import './houses.css'

interface Draft {
  name: string
  price: string
  checkout: string
  addons: Array<{ code?: string; label: string; price: string }>
}

const draftOf = (house: House): Draft => ({
  name: house.name,
  price: toRoubles(house.price_per_night),
  checkout: house.checkout_time,
  addons: house.addons.map((addon) => ({
    code: addon.code,
    label: addon.label,
    price: toRoubles(addon.default_price),
  })),
})

export function Houses() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const houses = useQuery({ queryKey: ['houses'], queryFn: () => api.get<House[]>('/api/houses') })

  async function signOut() {
    await api.post('/api/logout')
    queryClient.clear()
    await navigate('/login', { replace: true })
  }

  return (
    <Screen title="Дома">
      {houses.isPending && <p className="notice">Загружаем…</p>}

      {houses.error && (
        <div className="notice notice--bad" role="alert">
          <p className="notice__title">Не удалось загрузить дома</p>
          <p>{houses.error.message}</p>
        </div>
      )}

      {houses.data?.length === 0 && (
        <div className="notice">
          <p className="notice__title">Пока нет домов</p>
          <p>
            Дом заводится один раз командой <code>./run house:add</code> — она создаёт его в движке
            и записывает сюда. После этого здесь можно менять цену и дополнительные услуги.
          </p>
        </div>
      )}

      {/* Said once for the screen rather than on every card: repricing is safe by
          construction, because a booking carries its own snapshot. */}
      {(houses.data?.length ?? 0) > 0 && (
        <p className="houses__note">
          Изменение цен не затрагивает уже созданные брони — в них записана цена на день продажи.
        </p>
      )}

      {houses.data?.map((house) => (
        <HouseCard key={house.id} house={house} />
      ))}

      <button className="signout" type="button" onClick={() => void signOut()}>
        Выйти
      </button>
    </Screen>
  )
}

function HouseCard({ house }: { house: House }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftOf(house))
  const [error, setError] = useState<string | undefined>()

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/api/houses/${house.id}`, {
        name: draft.name,
        price_per_night: toMinor(draft.price),
        checkout_time: draft.checkout,
        addons: draft.addons.map((addon) => ({
          ...(addon.code === undefined ? {} : { code: addon.code }),
          label: addon.label,
          default_price: toMinor(addon.price),
        })),
      })
    },
    onSuccess: async () => {
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: ['houses'] })
      await queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  const setAddon = (index: number, patch: Partial<Draft['addons'][number]>) =>
    setDraft((current) => ({
      ...current,
      addons: current.addons.map((addon, at) => (at === index ? { ...addon, ...patch } : addon)),
    }))

  return (
    <form className="house" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Название</span>
        <input
          className="field__input"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          required
        />
      </label>

      <div className="field__row">
        <label className="field">
          <span className="field__label">Цена за ночь, ₽</span>
          <input
            className="field__input"
            value={draft.price}
            onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            inputMode="decimal"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Выезд</span>
          <input
            className="field__input"
            value={draft.checkout}
            onChange={(event) => setDraft({ ...draft, checkout: event.target.value })}
            placeholder="11:00"
            required
          />
        </label>
      </div>

      {/*
        Check-in is the engine's slot boundary, so it is shown and not offered for editing.
        Moving it would re-cut every night: a booking already made would straddle two slots,
        and the calendar would quietly stop matching reality.
      */}
      <p className="house__fixed">
        Заезд <strong>{house.checkin_time ?? '—'}</strong> — задаётся при создании дома, меняется
        командой <code>./run house:checkin</code>, и только пока нет будущих броней.
      </p>

      <fieldset className="addons">
        <legend className="field__label">Дополнительные услуги</legend>

        {draft.addons.length === 0 && <p className="addons__empty">Пока ничего не добавлено.</p>}

        {draft.addons.map((addon, index) => (
          <div className="addons__row" key={addon.code ?? `new-${index}`}>
            <input
              className="field__input"
              aria-label="Название услуги"
              value={addon.label}
              onChange={(event) => setAddon(index, { label: event.target.value })}
              placeholder="Баня"
              required
            />
            <input
              className="field__input addons__price"
              aria-label="Цена услуги"
              value={addon.price}
              onChange={(event) => setAddon(index, { price: event.target.value })}
              inputMode="decimal"
              placeholder="500"
              required
            />
            <button
              className="addons__remove"
              type="button"
              aria-label={`Убрать ${addon.label || 'услугу'}`}
              onClick={() =>
                setDraft({ ...draft, addons: draft.addons.filter((_, at) => at !== index) })
              }
            >
              ✕
            </button>
          </div>
        ))}

        <button
          className="btn btn--quiet addons__add"
          type="button"
          onClick={() =>
            setDraft({ ...draft, addons: [...draft.addons, { label: '', price: '' }] })
          }
        >
          Добавить услугу
        </button>
      </fieldset>

      {error !== undefined && (
        <p className="formerror" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button className="btn btn--primary" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>

      {save.isSuccess && !save.isPending && (
        <p className="house__saved" role="status">
          Сохранено · {money(toMinor(draft.price))} за ночь
        </p>
      )}
    </form>
  )
}
