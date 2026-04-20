type UnknownRecord = Record<string, unknown>;

export type MessageFieldValidator = (value: unknown, message: UnknownRecord) => boolean;

export type MessageFieldValidators<T extends { type: string }> = Partial<
  Record<Exclude<keyof T, 'type'>, MessageFieldValidator>
>;

export function isObjectRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function hasStringMessageType(value: unknown): value is { type: string } {
  return isObjectRecord(value) && typeof value.type === 'string';
}

export function createTypeMessageGuard<T extends { type: string }>(
  type: T['type'],
  validators: MessageFieldValidators<T> = {}
): (message: unknown) => message is T {
  return (message: unknown): message is T => {
    if (!hasStringMessageType(message) || message.type !== type) {
      return false;
    }

    const record = message as UnknownRecord;
    for (const [field, validator] of Object.entries(validators) as Array<
      [string, MessageFieldValidator]
    >) {
      if (!validator(record[field], record)) {
        return false;
      }
    }

    return true;
  };
}

export function isLiteralValue<T extends string | number | boolean | null>(
  expected: T
): (value: unknown) => value is T {
  return (value: unknown): value is T => value === expected;
}

export function isStringValue(value: unknown): value is string {
  return typeof value === 'string';
}
