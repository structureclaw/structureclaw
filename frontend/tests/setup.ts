import '@testing-library/jest-dom'

// Polyfills for Radix UI components in jsdom
// jsdom doesn't implement these DOM APIs that Radix UI uses

// Mock hasPointerCapture and releasePointerCapture
HTMLElement.prototype.hasPointerCapture = function (this: HTMLElement) {
  return false
}
HTMLElement.prototype.releasePointerCapture = function (this: HTMLElement) {}
HTMLElement.prototype.setPointerCapture = function (this: HTMLElement) {}

// Mock scrollIntoView
Element.prototype.scrollIntoView = function (this: Element) {}

// Mock getBoundingClientRect for Radix UI positioning
Element.prototype.getBoundingClientRect = function (this: Element) {
  return {
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect
}

// Mock clientWidth and clientHeight for Radix UI
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: {
    get() {
      return 0
    },
  },
  clientHeight: {
    get() {
      return 0
    },
  },
})

// Mock ResizeObserver for jsdom-only layout calculations
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

const eventSourceInstances: MockEventSource[] = []

class MockEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  url: string
  readyState: number = MockEventSource.CONNECTING
  onopen: ((this: EventSource, ev: Event) => any) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null
  onerror: ((this: EventSource, ev: Event) => any) | null = null

  constructor(url: string) {
    this.url = url
    // Track instances for testing
    eventSourceInstances.push(this)
    // Simulate async connection establishment
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN
      this.onopen?.call(this as unknown as EventSource, new Event('open'))
    }, 0)
  }

  close() {
    this.readyState = MockEventSource.CLOSED
  }

  addEventListener() {}
  removeEventListener() {}
}

// Expose instances for test access
(MockEventSource as any).__instances = eventSourceInstances

global.EventSource = MockEventSource as unknown as typeof EventSource
