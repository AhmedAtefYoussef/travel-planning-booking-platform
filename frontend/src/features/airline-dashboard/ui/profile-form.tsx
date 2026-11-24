'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ImageUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AirlineLogo } from '@/features/flights';
import { isApiError } from '@/shared/api/errors';
import { Button } from '@/shared/ui/button';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { updateAirline, uploadLogo } from '../api/mutations';
import { logoProblem, profileSchema, type ProfileInput } from '../model/forms';
import { FormAlert } from './form-alert';
import { useSave } from './use-save';

type Props = {
  airline: { id: string; name: string; code: string; logoUrl: string | null };
};

/** FLT-01: name and code of the moderator's airline. */
export function ProfileForm({ airline }: Props) {
  const form = useForm<ProfileInput, unknown, { name: string; code: string }>({
    defaultValues: { name: airline.name, code: airline.code },
    resolver: zodResolver(profileSchema),
  });
  const { register, handleSubmit, setError, formState, reset } = form;
  const { save, formError } = useSave(setError, ['name', 'code']);

  const onSubmit = handleSubmit(async (values) => {
    const saved = await save(
      () => updateAirline(airline.id, values),
      'Airline details saved',
    );
    if (saved) reset({ name: saved.name, code: saved.code });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <FormField
          label="Airline name"
          required
          error={formState.errors.name?.message}
        >
          {(props) => (
            <Input
              autoComplete="organization"
              {...props}
              {...register('name')}
            />
          )}
        </FormField>
        <FormField
          label="Code"
          required
          hint="2 or 3 letters or digits"
          error={formState.errors.code?.message}
        >
          {(props) => (
            <Input
              className="uppercase"
              maxLength={3}
              {...props}
              {...register('code')}
            />
          )}
        </FormField>
      </div>
      <div>
        <Button
          type="submit"
          disabled={formState.isSubmitting || !formState.isDirty}
        >
          {formState.isSubmitting ? <Spinner /> : null}
          Save details
        </Button>
      </div>
    </form>
  );
}

/** GEN-08 / FLT-01: replace the logo with one JPG or PNG up to 5 MB. */
export function LogoUpload({ airline }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = logoProblem(file);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await uploadLogo(airline.id, file);
      toast.success('Logo updated');
      router.refresh();
    } catch (e) {
      setError(
        isApiError(e)
          ? (e.fieldErrors.logo ?? e.message)
          : 'The logo could not be uploaded.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <AirlineLogo
        src={airline.logoUrl}
        code={airline.code}
        name={airline.name}
        size={80}
        className="rounded-xl"
      />
      <div className="grid gap-1">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          id="airline-logo"
          onChange={onChange}
          aria-describedby="airline-logo-hint"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <Spinner /> : <ImageUp aria-hidden="true" />}
          {airline.logoUrl ? 'Replace logo' : 'Upload logo'}
        </Button>
        <p id="airline-logo-hint" className="text-xs text-muted-foreground">
          JPG or PNG, up to 5 MB.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
