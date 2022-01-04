import React, { useRef, useState } from "react"
import { IndicatorButtonTooltip } from "../tooltips"
import { spinnerIcon } from "../icons"

export default function IndicatorButton({
  buttonIndex,
  tooltipContent,
  overrideShowTooltip = false,
  iconSvg,
  onClick,
  showSpinner,
  active = false,
  testId,
  onMouseEnter,
  hoverable,
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const isFirstButton = buttonIndex === 0
  const marginTop = isFirstButton ? `0px` : `8px`

  const onMouseLeave = () => setShowTooltip(false)
  const onButtonClick = event => {
    event.stopPropagation()
    if (active && onClick) {
      onClick()
    }
  }

  return (
    <>
      <button
        data-gatsby-preview-indicator="button"
        data-gatsby-preview-indicator-active-button={`${active}`}
        data-gatsby-preview-indicator-hoverable={
          active && hoverable ? `true` : `false`
        }
        style={{ marginTop: marginTop }}
        onMouseEnter={() => {
          setShowTooltip(true)

          if (onMouseEnter) {
            onMouseEnter()
          }
        }}
        onMouseLeave={onMouseLeave}
        onClick={onButtonClick}
      >
        <div data-testid={`${testId}-button`}>
          {iconSvg}
          {showSpinner && (
            <div data-gatsby-preview-indicator="spinner">{spinnerIcon}</div>
          )}
        </div>
        {tooltipContent && (
          <IndicatorButtonTooltip
            tooltipContent={tooltipContent}
            overrideShowTooltip={overrideShowTooltip}
            showTooltip={showTooltip}
            testId={testId}
          />
        )}
      </button>
    </>
  )
}
