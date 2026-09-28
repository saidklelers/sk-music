import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, space, type } from '@/theme';

import { Button } from './Primitives';
import { Sheet } from './Sheet';

export type PromptField = {
  key: string;
  label?: string;
  placeholder?: string;
  /** Valor con el que se abre el campo. */
  initial?: string;
  /** Si es obligatorio, el botón no se activa mientras esté vacío. */
  required?: boolean;
};

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  fields: PromptField[];
  confirmLabel: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  onClose: () => void;
};

/**
 * Hoja con uno o varios campos de texto y un botón de confirmar.
 *
 * El formulario sólo existe mientras la hoja está visible: así cada apertura
 * arranca con los valores iniciales frescos, sin tener que resetear estado
 * desde un efecto.
 */
export function PromptSheet({ visible, title, subtitle, onClose, ...form }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      {visible && <PromptForm {...form} onClose={onClose} />}
    </Sheet>
  );
}

function PromptForm({
  fields,
  confirmLabel,
  onSubmit,
  onClose,
}: Pick<Props, 'fields' | 'confirmLabel' | 'onSubmit' | 'onClose'>) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])),
  );
  const [saving, setSaving] = useState(false);

  const valid = fields.every((f) => !f.required || values[f.key]?.trim());

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      {fields.map((field, i) => (
        <View key={field.key} style={styles.field}>
          {!!field.label && <Text style={styles.label}>{field.label}</Text>}
          <TextInput
            value={values[field.key]}
            onChangeText={(text) => setValues((v) => ({ ...v, [field.key]: text }))}
            placeholder={field.placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoFocus={i === 0}
            selectTextOnFocus
            returnKeyType={i === fields.length - 1 ? 'done' : 'next'}
            onSubmitEditing={i === fields.length - 1 ? () => void submit() : undefined}
            submitBehavior={i === fields.length - 1 ? 'blurAndSubmit' : 'submit'}
          />
        </View>
      ))}
      <Button
        label={confirmLabel}
        onPress={() => void submit()}
        disabled={!valid}
        loading={saving}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.md,
  },
  field: { gap: space.xs },
  label: { ...type.label, color: colors.textFaint },
  input: {
    height: 48,
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    ...type.body,
    color: colors.text,
  },
  button: { marginTop: space.xs },
});
