import { createContext, useContext, useRef, type ReactNode } from 'react'
import { KeyboardAvoidingView, ScrollView, TextInput, type ScrollViewInstance, type TextInputProps } from 'react-native'
import { styles } from './styles'

/** How far above the top of the screen the field that is typed in is put, so that it is not under the edge. */
const FIELD_MARGIN = 24

const ScrollToField = createContext<(top: number) => void>(() => undefined)

/**
 * A form that stays out from under the keyboard. The space the keyboard takes is not the form's, and the
 * field that is typed in is scrolled up to where it can be seen: the fields below it are covered anyway,
 * and the ones above it are what is already written.
 */
export function FormScroll(props: { children: ReactNode }) {
  const scroll = useRef<ScrollViewInstance>(null)
  const scrollToField = (top: number) => scroll.current?.scrollTo({ y: Math.max(0, top - FIELD_MARGIN), animated: true })
  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <ScrollView ref={scroll} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <ScrollToField.Provider value={scrollToField}>{props.children}</ScrollToField.Provider>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/** A field of a `FormScroll`. It knows where it is, and has the form scroll to it when it is typed in. */
export function FormInput(props: TextInputProps) {
  const scrollToField = useContext(ScrollToField)
  const top = useRef(0)
  return (
    <TextInput
      {...props}
      style={[styles.input, props.style]}
      onLayout={(event) => {
        top.current = event.nativeEvent.layout.y
        props.onLayout?.(event)
      }}
      onFocus={(event) => {
        scrollToField(top.current)
        props.onFocus?.(event)
      }}
    />
  )
}
