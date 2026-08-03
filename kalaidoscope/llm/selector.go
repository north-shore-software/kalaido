package llm

import "context"

var (
	providerFactory func(model string) Provider
	activeSet       = SetLocal
)

func SetProviderFactory(f func(model string) Provider) {
	providerFactory = f
}

func Ready() bool {
	return providerFactory != nil
}

func SetActiveModelSet(s ModelSet) {
	activeSet = s
}

func ActiveModelSet() ModelSet {
	return activeSet
}

func ResolveRole(r Role) (string, error) {
	return ModelFor(activeSet, r)
}

func ErrorProvider(err error) Provider {
	return errProvider{err: err}
}

type errProvider struct{ err error }

func (p errProvider) Stream(context.Context, []Message, []Tool) (*Completion, error) {
	return nil, p.err
}

func SelectedProvider(model string) Provider {
	if providerFactory == nil {
		panic("llm: no provider factory registered; call llm.SetProviderFactory at startup")
	}
	return providerFactory(model)
}
