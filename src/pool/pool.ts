import type { Slot, SlotState, WorkerResult } from "./types.js";

export class Pool {
  private slots: Map<string, Slot> = new Map();
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  allocate(slotId: string, workerId: string, entityId: string, prompt: string): Slot {
    const slot: Slot = {
      slotId,
      workerId,
      entityId,
      state: "claimed",
      prompt,
      result: null,
    };
    this.slots.set(slotId, slot);
    return slot;
  }

  complete(slotId: string, result: WorkerResult): void {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Unknown slot: ${slotId}`);
    slot.result = result;
    slot.state = "reporting";
  }

  release(slotId: string): void {
    this.slots.delete(slotId);
  }

  setState(slotId: string, state: SlotState): void {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Unknown slot: ${slotId}`);
    slot.state = state;
  }

  availableSlots(): number {
    return this.capacity - this.slots.size;
  }

  activeSlots(): Slot[] {
    return Array.from(this.slots.values());
  }
}
