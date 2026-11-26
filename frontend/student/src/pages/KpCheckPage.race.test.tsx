import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,useNavigate} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import KpCheckPage from './KpCheckPage';
const mocks=vi.hoisted(()=>({getLearnBundle:vi.fn(),diagnoseKp:vi.fn(),getPracticeSession:vi.fn(),submitAnswer:vi.fn()}));
vi.mock('../api/client',()=>({api:mocks}));
vi.mock('../api/studentIdentity',()=>({getStudentId:()=> 'audit-student',getStudentProfile:()=>({id:'audit-student',status: 'active',})}));
vi.mock('../components/QuestionSessionRunner',()=>({default:({questions,onAnswer}:any)=><div>{questions[0].id}<button onClick={()=>onAnswer(questions[0].id,'A')}>提交当前题</button></div>}));
vi.mock('../components/SessionResultDialog',()=>({default:()=>null}));
function GoB(){const navigate=useNavigate();return <button onClick={()=>navigate('/learn/check?kp=kp-B')}>切到B知识点</button>;}

it('ignores late responses from the previous knowledge point',async()=>{
  let resolveA!:(session:any)=>void;
  let resolveB!:(session:any)=>void;
  mocks.getLearnBundle.mockImplementation(async(id:string)=>({kp_id:id,kp_name:id}));
  mocks.diagnoseKp.mockImplementation((id:string)=>new Promise(resolve=>{if(id==='kp-A')resolveA=resolve;else resolveB=resolve;}));
  mocks.submitAnswer.mockResolvedValue({answer_id:1,is_correct:true,correct_answer:'A',mastery_update:{}});
  render(<MemoryRouter initialEntries={['/learn/check?kp=kp-A']}><GoB/><KpCheckPage/></MemoryRouter>);
  await waitFor(()=>expect(mocks.diagnoseKp).toHaveBeenCalledWith('kp-A',3,'audit-student'));
  await userEvent.click(screen.getByRole('button',{name:'切到B知识点'}));
  await waitFor(()=>expect(mocks.diagnoseKp).toHaveBeenCalledWith('kp-B',3,'audit-student'));
  await act(async()=>resolveB({questions:[{id:'question-B',options:[]}]}));
  expect(screen.getByText('question-B')).toBeInTheDocument();
  await act(async()=>resolveA({questions:[{id:'question-A',options:[]}]}));
  expect(screen.getByText('question-B')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'提交当前题'}));
  expect(mocks.submitAnswer).toHaveBeenCalledWith('audit-student',expect.objectContaining({question_id:'question-B',target_knowledge_point_id:'kp-B'}));
});
