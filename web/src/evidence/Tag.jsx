// Status chip for the evidence screens. Always carries a word (never colour alone); state is ok | warn | bad | info.
export const Tag = ({ state = "info", children, title, testId }) => <span className="ev-tag" data-state={state} title={title} data-testid={testId}>{children}</span>;
