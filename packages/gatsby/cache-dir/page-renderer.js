import React, { createElement, useEffect } from "react"
import { createRoot } from "react-dom/client"
import PropTypes from "prop-types"
import { apiRunner } from "./api-runner-browser"
import { grabMatchParams } from "./find-path"
import { StaticQueryContext } from "gatsby"
import { VALID_NODE_NAMES } from "./head/constants"

// Calls callback in an effect and renders children
function Caller({ children, callback }) {
  useEffect(() => {
    callback()
  }, [callback])

  return children
}

// Renders page
function PageRenderer(props) {
  const _props = {
    ...props,
    params: {
      ...grabMatchParams(props.location.pathname),
      ...props.pageResources.json.pageContext.__params,
    },
  }

  const preferDefault = m => (m && m.default) || m

  const pageElement = createElement(
    preferDefault(props.pageResources.component),
    {
      ...props,
      key: props.path || props.pageResources.page.path,
    }
  )

  const pageComponent = props.pageResources.component

  if (pageComponent.head) {
    if (typeof pageComponent.head !== `function`)
      throw new Error(
        `Expected "head" export to be a function got "${typeof pageComponent.head}".`
      )

    const headElement = createElement(
      StaticQueryContext.Provider,
      { value: props.pageResources.staticQueryResults },
      createElement(pageComponent.head, _props, null)
    )

    useEffect(() => {
      const hiddenRoot = document.createElement(`div`)
      const root = createRoot(hiddenRoot)

      const callback = () => {
        // Remove previous head nodes
        const prevHeadNodes = [
          ...document.querySelectorAll(`[data-gatsby-head]`),
        ]
        prevHeadNodes.forEach(e => e.remove())

        // add attribute to new head nodes while showing warning if it's not a valid node
        let validHeadNodes = []

        for (const node of hiddenRoot.childNodes) {
          const nodeName = node.nodeName.toLowerCase()

          if (!VALID_NODE_NAMES.includes(nodeName)) {
            if (process.env.NODE_ENV !== `production`) {
              const warning =
                nodeName !== `script`
                  ? `<${nodeName}> is not a valid head element. Please use one of the following: ${VALID_NODE_NAMES.join(
                      `, `
                    )}`
                  : `Do not add scripts here. Please use the <Script> component in your page template instead. For more info see: https://www.gatsbyjs.com/docs/reference/built-in-components/gatsby-script/`
              console.warn(warning)
            }
          } else {
            node.setAttribute(`data-gatsby-head`, true)
            validHeadNodes = [...validHeadNodes, node]
          }
        }

        document.head.append(...validHeadNodes)
      }
      // just a hack to call the callback after react has done first render
      root.render(<Caller callback={callback}>{headElement}</Caller>)
    }, [headElement])
  }
  const wrappedPage = apiRunner(
    `wrapPageElement`,
    { element: pageElement, props },
    pageElement,
    ({ result }) => {
      return { element: result, props }
    }
  ).pop()

  return wrappedPage
}

PageRenderer.propTypes = {
  location: PropTypes.object.isRequired,
  pageResources: PropTypes.object.isRequired,
  data: PropTypes.object,
  pageContext: PropTypes.object.isRequired,
}

export default PageRenderer
