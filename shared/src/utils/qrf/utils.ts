import fhirpath from 'fhirpath';
import _ from 'lodash';
import isArray from 'lodash/isArray';
import isPlainObject from 'lodash/isPlainObject';
import queryString from 'query-string';

import {
    Questionnaire,
    QuestionnaireItem,
    QuestionnaireItemEnableWhen,
    QuestionnaireItemInitial,
    QuestionnaireResponse,
    QuestionnaireResponseItem,
    QuestionnaireResponseItemAnswer,
} from 'shared/src/contrib/aidbox';

import {
    AnswerValue,
    FormAnswerItems,
    FormGroupItems,
    FormItems,
    ItemContext,
    QuestionnaireResponseFormData,
    RepeatableFormGroupItems,
} from './types';

export function wrapAnswerValue(type: QuestionnaireItem['type'], answer: any) {
    if (type === 'choice') {
        if (isPlainObject(answer)) {
            return { Coding: answer };
        } else {
            return { string: answer };
        }
    }

    if (type === 'open-choice') {
        if (isPlainObject(answer)) {
            return { Coding: answer };
        } else {
            return { string: answer };
        }
    }

    if (type === 'text') {
        return { string: answer };
    }

    if (type === 'attachment') {
        return { Attachment: answer };
    }

    if (type === 'reference') {
        return { Reference: answer };
    }

    if (type === 'quantity') {
        return { Quantity: answer };
    }

    return { [type]: answer };
}

export function getBranchItems(
    fieldPath: string[],
    questionnaire: Questionnaire,
    questionnaireResponse: QuestionnaireResponse,
): { qItem: QuestionnaireItem; qrItems: QuestionnaireResponseItem[] } {
    let qrItem: QuestionnaireResponseItem | QuestionnaireResponse | undefined =
        questionnaireResponse;
    let qItem: QuestionnaireItem | Questionnaire = questionnaire;

    // TODO: check for question with sub items
    // TODO: check for root
    for (let i = 0; i < fieldPath.length; i++) {
        qItem = qItem.item!.find((curItem: any) => curItem.linkId === fieldPath[i])!;

        if (qrItem) {
            const qrItems: QuestionnaireResponseItem[] =
                qrItem.item?.filter((curItem: any) => curItem.linkId === fieldPath[i]) ?? [];

            if (qItem.repeats) {
                if (i + 2 < fieldPath.length) {
                    // In the middle
                    qrItem = qrItems[parseInt(fieldPath[i + 2], 10)];
                } else {
                    // Leaf
                    return { qItem, qrItems };
                }
            } else {
                qrItem = qrItems[0];
            }
        }

        if (qItem.repeats || qItem.type !== 'group') {
            i += 2;
        } else {
            i++;
        }
    }

    return { qItem, qrItems: [qrItem] } as {
        qItem: QuestionnaireItem;
        qrItems: QuestionnaireResponseItem[];
    };
}

export function calcContext(
    initialContext: ItemContext,
    variables: QuestionnaireItem['variable'],
    qItem: QuestionnaireItem,
    qrItem: QuestionnaireResponseItem,
): ItemContext {
    // TODO: add root variable support
    return {
        ...(variables || []).reduce(
            (acc, curVariable) => ({
                ...acc,
                [curVariable.name!]: fhirpath.evaluate(qrItem || {}, curVariable.expression!, acc),
            }),
            { ...initialContext, context: qrItem, qitem: qItem },
        ),
    };
}

export function compareValue(firstAnswerValue: AnswerValue, secondAnswerValue: AnswerValue) {
    const firstValueType = _.keys(firstAnswerValue)[0];
    const secondValueType = _.keys(secondAnswerValue)[0];
    if (firstValueType !== secondValueType) {
        throw new Error('Enable when must be used for the same type');
    }
    if (
        !_.includes(
            ['string', 'date', 'dateTime', 'time', 'uri', 'boolean', 'integer', 'decimal'],
            firstValueType,
        )
    ) {
        throw new Error('Impossible to compare non-primitive type');
    }

    if (firstValueType === 'Quantity') {
        throw new Error('Quantity type is not supported yet');
    }

    const firstValue = firstAnswerValue[firstValueType];
    const secondValue = secondAnswerValue[secondValueType];

    if (firstValue < secondValue) {
        return -1;
    }
    if (firstValue > secondValue) {
        return 1;
    }
    return 0;
}

function isGroup(question: QuestionnaireItem) {
    return question.type === 'group';
}

function isFormGroupItems(
    question: QuestionnaireItem,
    answers: FormGroupItems | FormAnswerItems[],
): answers is FormGroupItems {
    return isGroup(question) && _.isPlainObject(answers);
}

function isRepeatableFormGroupItems(
    question: QuestionnaireItem,
    answers: FormGroupItems,
): answers is RepeatableFormGroupItems {
    return !!question.repeats && _.isArray(answers.items);
}

function hasSubAnswerItems(items?: FormItems): items is FormItems {
    return !!items && _.some(items, (x) => !_.some(x, _.isEmpty));
}

function mapFormToResponseRecursive(
    answersItems: FormItems,
    questionnaireItems: QuestionnaireItem[],
    checkQuestionEnabled: (question: QuestionnaireItem) => boolean,
): QuestionnaireResponseItem[] {
    return Object.entries(answersItems).reduce((acc, [linkId, answers]) => {
        if (!linkId) {
            console.warn('The answer item has no linkId');
            return acc;
        }

        const question = questionnaireItems.filter((qItem) => qItem.linkId === linkId)[0];

        if (!question) {
            return acc;
        }

        if (!checkQuestionEnabled(question)) {
            return acc;
        }

        if (isFormGroupItems(question, answers)) {
            const groups = isRepeatableFormGroupItems(question, answers)
                ? answers.items || []
                : answers.items
                ? [answers.items]
                : [];
            return groups.reduce((newAcc, group) => {
                const items = mapFormToResponseRecursive(
                    group,
                    question.item ?? [],
                    checkQuestionEnabled,
                );

                return [
                    ...newAcc,
                    {
                        linkId,
                        ...(items.length ? { item: items } : {}),
                    },
                ];
            }, acc);
        }

        return [
            ...acc,
            {
                linkId,
                answer: answers.reduce((answersAcc, answer) => {
                    if (!answer.value) {
                        return answersAcc;
                    }

                    const items = hasSubAnswerItems(answer.items)
                        ? mapFormToResponseRecursive(
                              answer.items,
                              question.item ?? [],
                              checkQuestionEnabled,
                          )
                        : [];

                    return [
                        ...answersAcc,
                        {
                            value: answer.value,
                            ...(items.length ? { item: items } : {}),
                        },
                    ];
                }, [] as QuestionnaireResponseItemAnswer[]),
            },
        ];
    }, [] as QuestionnaireResponseItem[]);
}

export function mapFormToResponse(
    answersItems: FormItems,
    questionnaire: Questionnaire,
    keepDisabledAnswers?: boolean,
): Pick<QuestionnaireResponse, 'item'> {
    const checkQuestionEnabled = (question: QuestionnaireItem) =>
        question.enableWhen && !keepDisabledAnswers
            ? isQuestionEnabled(question.enableWhen, question.enableBehavior, [], answersItems)
            : true;

    return {
        item: mapFormToResponseRecursive(
            answersItems,
            questionnaire.item ?? [],
            checkQuestionEnabled,
        ),
    };
}

function mapResponseToFormRecursive(
    questionnaireResponseItems: QuestionnaireResponseItem[],
    questionnaireItems: QuestionnaireItem[],
): FormItems {
    return questionnaireItems.reduce((acc, question) => {
        const { linkId, initial, repeats, text } = question;

        if (!linkId) {
            console.warn('The question has no linkId');
            return acc;
        }

        const qrItems =
            questionnaireResponseItems.filter((qrItem) => qrItem.linkId === linkId) ?? [];

        if (qrItems.length && isGroup(question)) {
            if (repeats) {
                return {
                    ...acc,
                    [linkId]: {
                        question: text,
                        items: qrItems.map((qrItem) => {
                            return mapResponseToFormRecursive(
                                qrItem.item ?? [],
                                question.item ?? [],
                            );
                        }),
                    },
                };
            } else {
                return {
                    ...acc,
                    [linkId]: {
                        question: text,
                        items: mapResponseToFormRecursive(
                            qrItems[0].item ?? [],
                            question.item ?? [],
                        ),
                    },
                };
            }
        }

        const answers = qrItems?.[0]?.answer?.length
            ? qrItems[0].answer
            : initialToQuestionnaireResponseItemAnswer(initial);

        if (!answers.length) {
            return acc;
        }

        return {
            ...acc,
            [linkId]: answers.map((answer) => ({
                question: text,
                value: answer.value,
                items: mapResponseToFormRecursive(answer.item ?? [], question.item ?? []),
            })),
        };
    }, {});
}

export function mapResponseToForm(resource: QuestionnaireResponse, questionnaire: Questionnaire) {
    return mapResponseToFormRecursive(resource.item ?? [], questionnaire.item ?? []);
}

function initialToQuestionnaireResponseItemAnswer(initial: QuestionnaireItemInitial[] | undefined) {
    return (initial ?? []).map(({ value }) => ({ value } as QuestionnaireResponseItemAnswer));
}

export function findAnswersForQuestionsRecursive(linkId: string, values?: FormItems): any | null {
    if (values && _.has(values, linkId)) {
        return values[linkId];
    }

    return _.reduce(
        values,
        (acc, v) => {
            if (acc) {
                return acc;
            }

            if (_.isArray(v)) {
                return _.reduce(
                    v,
                    (acc2, v2) => {
                        if (acc2) {
                            return acc2;
                        }

                        return findAnswersForQuestionsRecursive(linkId, v2.items);
                    },
                    null,
                );
            } else if (_.isArray(v.items)) {
                return _.reduce(
                    v.items,
                    (acc2, v2) => {
                        if (acc2) {
                            return acc2;
                        }

                        return findAnswersForQuestionsRecursive(linkId, v2);
                    },
                    null,
                );
            } else {
                return findAnswersForQuestionsRecursive(linkId, v.items);
            }
        },
        null,
    );
}

export function findAnswersForQuestion<T = any>(
    linkId: string,
    parentPath: string[],
    values: FormItems,
): Array<FormAnswerItems<T>> {
    const p = _.cloneDeep(parentPath);

    // Go up
    while (p.length) {
        const part = p.pop();

        if (part === 'items') {
            if (_.has(_.get(values, [...p, part]), linkId)) {
                return _.get(values, [...p, part, linkId]);
            }
        }
    }

    // Go down
    const answers = findAnswersForQuestionsRecursive(linkId, values);

    return answers ? answers : [];
}

export function isValueEqual(firstValue: AnswerValue, secondValue: AnswerValue) {
    const firstValueType = _.keys(firstValue)[0];
    const secondValueType = _.keys(secondValue)[0];

    if (firstValueType !== secondValueType) {
        throw new Error('Enable when must be used for the same type');
    }

    if (firstValueType === 'Coding') {
        // NOTE: what if undefined === undefined
        return firstValue.Coding?.code === secondValue.Coding?.code;
    }

    return _.isEqual(firstValue, secondValue);
}

export function getChecker(
    operator: string,
): (values: Array<{ value: any }>, answerValue: any) => boolean {
    if (operator === '=') {
        return (values, answerValue) =>
            _.findIndex(values, ({ value }) => isValueEqual(value, answerValue)) !== -1;
    }

    if (operator === '!=') {
        return (values, answerValue) =>
            _.findIndex(values, ({ value }) => isValueEqual(value, answerValue)) === -1;
    }

    if (operator === 'exists') {
        return (values, answerValue) => {
            const answersLength = _.reject(values, (value) => _.isEmpty(value.value)).length;
            const answer = answerValue?.boolean ?? true;
            return answersLength > 0 === answer;
        };
    }

    if (operator === '>=') {
        return (values, answerValue) =>
            _.findIndex(
                _.reject(values, (value) => _.isEmpty(value.value)),
                ({ value }) => compareValue(value, answerValue) >= 0,
            ) !== -1;
    }

    if (operator === '>') {
        return (values, answerValue) =>
            _.findIndex(
                _.reject(values, (value) => _.isEmpty(value.value)),
                ({ value }) => compareValue(value, answerValue) > 0,
            ) !== -1;
    }

    if (operator === '<=') {
        return (values, answerValue) =>
            _.findIndex(
                _.reject(values, (value) => _.isEmpty(value.value)),
                ({ value }) => compareValue(value, answerValue) <= 0,
            ) !== -1;
    }

    if (operator === '<') {
        return (values, answerValue) =>
            _.findIndex(
                _.reject(values, (value) => _.isEmpty(value.value)),
                ({ value }) => compareValue(value, answerValue) < 0,
            ) !== -1;
    }

    console.error(`Unsupported enableWhen.operator ${operator}`);

    return _.constant(true);
}

function isQuestionEnabled(
    enableWhen: QuestionnaireItemEnableWhen[],
    enableBehavior: string | undefined,
    parentPath: string[],
    values: FormItems,
) {
    const iterFn = enableBehavior === 'any' ? _.some : _.every;

    return iterFn(enableWhen, ({ question, answer, operator }) => {
        const check = getChecker(operator);

        if (_.includes(parentPath, question)) {
            // TODO: handle double-nested values
            const parentAnswerPath = _.slice(parentPath, 0, parentPath.length - 1);
            const parentAnswer = _.get(values, parentAnswerPath);

            return check(parentAnswer ? [parentAnswer] : [], answer);
        }

        const answers = findAnswersForQuestion(question, parentPath, values);

        return check(_.compact(answers), answer);
    });
}

export function getEnabledQuestions(
    items: QuestionnaireItem[],
    parentPath: string[],
    values: FormItems,
) {
    return _.filter(items, (item) => {
        const { enableWhen, enableBehavior, linkId } = item;

        if (!linkId) {
            return false;
        }

        if (enableWhen) {
            if (!isQuestionEnabled(enableWhen, enableBehavior, parentPath, values)) {
                return false;
            }
        }

        return true;
    });
}

export function calcInitialContext(
    qrfDataContext: QuestionnaireResponseFormData['context'],
    values: FormItems,
): ItemContext {
    const questionnaireResponse = {
        ...qrfDataContext.questionnaireResponse,
        ...mapFormToResponse(values, qrfDataContext.questionnaire, true),
    };

    return {
        ...qrfDataContext.launchContextParameters.reduce(
            (acc, { name, value, resource }) => ({
                ...acc,
                [name]: value && isPlainObject(value) ? value[Object.keys(value)[0]] : resource,
            }),
            {},
        ),

        // Vars defined in IG
        questionnaire: qrfDataContext.questionnaire,
        resource: questionnaireResponse,
        context: questionnaireResponse,

        // Vars we use for backward compatibility
        Questionnaire: qrfDataContext.questionnaire,
        QuestionnaireResponse: questionnaireResponse,
    };
}

function resolveTemplateExpr(str: string, context: ItemContext) {
    const matches = str.match(/{{[^}]+}}/g);

    if (matches) {
        return matches.reduce((result, match) => {
            const expr = match.replace(/[{}]/g, '');

            const resolvedVar = fhirpath.evaluate(context.context || {}, expr, context);

            if (resolvedVar?.length) {
                return result.replace(match, resolvedVar.join(','));
            } else {
                return result.replace(match, '');
            }
        }, str);
    }

    return str;
}

export function parseFhirQueryExpression(expression: string, context: ItemContext) {
    const [resourceType, paramsQS] = expression.split('?', 2);
    const searchParams = Object.fromEntries(
        Object.entries(queryString.parse(paramsQS)).map(([key, value]) => {
            if (!value) {
                return [key, value];
            }

            return [
                key,
                isArray(value)
                    ? value.map((arrValue) => resolveTemplateExpr(arrValue, context))
                    : resolveTemplateExpr(value, context),
            ];
        }),
    );

    return [resourceType, searchParams];
}
