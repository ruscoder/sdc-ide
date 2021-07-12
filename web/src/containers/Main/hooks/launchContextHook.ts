import { useReducer } from 'react';
import { Parameters as ParametersBase, Questionnaire, Resource } from 'shared/src/contrib/aidbox';
import { getData, setData } from 'src/services/localStorage';

type Parameters = ParametersBase & Required<Pick<ParametersBase, 'parameter'>>;

// SetResource action
type SetResource = 'SetResource';

interface SetResourceAction {
    type: SetResource;
    name: string;
    resource: Resource;
}

export function setResource(action: Omit<SetResourceAction, 'type'>): SetResourceAction {
    return {
        ...action,
        type: 'SetResource',
    };
}
// SetResource action

// Init action
type Init = 'Init';

interface InitAction {
    type: Init;
    questionnaire: Questionnaire;
}

export function init(questionnaire: Questionnaire): InitAction {
    return {
        type: 'Init',
        questionnaire,
    };
}
// Init action

export type Action = SetResourceAction | InitAction;

function reducer(state: Parameters, action: Action) {
    if (action.type == 'SetResource') {
        const saved = getData('launchContextParameters');
        setData('launchContextParameters', {
            [action.name]: action.resource,
            ...saved,
        });
        const isResource = Object.keys(action.resource).length > 1;
        const data = isResource ? { resource: action.resource } : action.resource;
        return {
            ...state,
            parameter: state.parameter.map((p) => (p.name == action.name ? { ...p, ...data } : p)),
        };
    } else if (action.type == 'Init') {
        return {
            ...state,
            parameter: [
                { name: 'Questionnaire', resource: action.questionnaire },
                ...(action.questionnaire.launchContext ?? []).map(({ name }) => {
                    if (name) {
                        const saved = getData('launchContextParameters')[name];
                        const isResource = Object.keys(saved).length > 1;
                        const data = isResource ? { resource: saved } : saved;
                        return {
                            name,
                            ...(saved ? data : {}),
                        };
                    } else {
                        throw new Error('Name is missing in launchContext');
                    }
                }),
            ],
        };
    } else {
        const _action: never = action;
        console.error(`Unknown action ${_action}`);
    }
    return state;
}

export function useLaunchContext() {
    return useReducer(reducer, { resourceType: 'Parameters', parameter: [] });
}
